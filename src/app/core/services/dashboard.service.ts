import { Injectable, inject, computed, Signal } from '@angular/core';
import { TaskService } from './task.service';
import { CategoryService } from './category.service';
import { AuthService } from './auth.service';
import { ActivityService } from './activity.service';
import { Task, TaskPriority } from '@shared/models/task.model';
import {
  DashboardStats, FocusTask, CategoryProgress, WeeklyProductivity,
  WeeklyDay, DashboardRecommendation, ProductivityScore
} from '@shared/models/dashboard.model';
import { ActivityEvent } from '@shared/models/activity.model';

// ============================================================
// DashboardService
// ------------------------------------------------------------
// The dashboard "intelligence" layer. Every member is a reusable
// `computed()` signal derived ENTIRELY from the existing service
// signals (TaskService / CategoryService / AuthService). It opens
// NO Firestore listeners of its own — the goal is a single source
// of truth reused across the dashboard and any future widgets.
//
// Consumers (e.g. DashboardComponent, Developer 1's widgets) simply
// read these signals; recomputation is memoised by Angular and only
// re-runs when an upstream task/category/profile signal changes.
// ============================================================

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const DAY_MS = 86_400_000;

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly tasks      = inject(TaskService);
  private readonly categories = inject(CategoryService);
  private readonly auth       = inject(AuthService);
  private readonly activity   = inject(ActivityService);

  // ---- Headline stats -------------------------------------------------

  readonly stats: Signal<DashboardStats> = computed(() => {
    const all = this.tasks.tasks();
    return {
      total:      all.length,
      today:      this.tasks.todayTasks().length,
      overdue:    this.tasks.overdueTasks().length,
      completed:  all.filter(t => t.status === 'completed').length,
      inProgress: all.filter(t => t.status === 'in_progress').length,
      rate:       this.tasks.completionRate(),
    };
  });

  // ---- Today's Focus Task ---------------------------------------------

  /**
   * The single most important open task to tackle next. Ranked by:
   * overdue → due-today → priority → soonest due date. `null` when the
   * user has nothing actionable.
   */
  readonly focusTask: Signal<FocusTask | null> = computed(() => {
    const now      = Date.now();
    const open     = this.tasks.tasks().filter(t => this.isOpen(t));
    if (!open.length) return null;

    const ranked = [...open].sort((a, b) => this.focusKey(a, now) - this.focusKey(b, now));
    const task   = ranked[0];
    return { task, reason: this.focusReason(task, now) };
  });

  // ---- Upcoming Deadlines ---------------------------------------------

  /** Open tasks due within the next 7 days, soonest first (top 6). */
  readonly upcomingDeadlines: Signal<Task[]> = computed(() =>
    [...this.tasks.getTasksDueInDays(7)]
      .sort((a, b) => (a.dueDate?.seconds ?? 0) - (b.dueDate?.seconds ?? 0))
      .slice(0, 6)
  );

  // ---- Recently Completed ---------------------------------------------

  /** Most recently completed tasks (top 5), newest first. */
  readonly recentlyCompleted: Signal<Task[]> = computed(() =>
    this.tasks.tasks()
      .filter(t => t.status === 'completed' && t.completedAt)
      .sort((a, b) => (b.completedAt?.seconds ?? 0) - (a.completedAt?.seconds ?? 0))
      .slice(0, 5)
  );

  // ---- Category Progress ----------------------------------------------

  readonly categoryProgress: Signal<CategoryProgress[]> = computed(() => {
    const tasks = this.tasks.tasks();
    return this.categories.rootCategories()
      .map(category => {
        const count = tasks.filter(t => t.categoryIds.includes(category.id)).length;
        const done  = tasks.filter(t => t.categoryIds.includes(category.id) && t.status === 'completed').length;
        return { category, count, done, percent: count ? Math.round((done / count) * 100) : 0 };
      })
      .filter(r => r.count > 0);
  });

  // ---- Weekly Productivity Summary ------------------------------------

  readonly weeklyProductivity: Signal<WeeklyProductivity> = computed(() => {
    const tasks    = this.tasks.tasks();
    const todayKey = this.startOfDay(new Date()).getTime();

    const days: WeeklyDay[] = [];
    for (let i = 6; i >= 0; i--) {
      const start = todayKey - i * DAY_MS;
      const end   = start + DAY_MS;
      const d     = new Date(start);
      days.push({
        date:      d,
        label:     d.toLocaleDateString('en-US', { weekday: 'short' }),
        isToday:   start === todayKey,
        created:   tasks.filter(t => this.inRange(t.createdAt?.toMillis(), start, end)).length,
        completed: tasks.filter(t => t.status === 'completed' && this.inRange(t.completedAt?.toMillis(), start, end)).length,
      });
    }

    const completedThisWeek = days.reduce((s, d) => s + d.completed, 0);
    const createdThisWeek   = days.reduce((s, d) => s + d.created, 0);

    // Prior 7-day window, for the trend arrow.
    const priorStart = todayKey - 13 * DAY_MS;
    const priorEnd   = todayKey - 6 * DAY_MS;
    const priorCompleted = tasks.filter(t =>
      t.status === 'completed' && this.inRange(t.completedAt?.toMillis(), priorStart, priorEnd)
    ).length;

    return {
      days,
      completedThisWeek,
      createdThisWeek,
      peakCompleted: Math.max(...days.map(d => d.completed), 1),
      avgPerDay:     Math.round((completedThisWeek / 7) * 10) / 10,
      trendPercent:  priorCompleted
        ? Math.round(((completedThisWeek - priorCompleted) / priorCompleted) * 100)
        : (completedThisWeek > 0 ? 100 : 0),
    };
  });

  // ---- Recent Activity ------------------------------------------------

  /**
   * Recent cross-entity activity for the dashboard (top 8), sourced from
   * the shared ActivityService global feed (tasks + groups) — one
   * derivation engine, reused here and by <tp-activity-feed>.
   */
  readonly recentActivity: Signal<ActivityEvent[]> = computed(() =>
    this.activity.feed().slice(0, 8)
  );

  // ---- Smart Recommendations ------------------------------------------

  /** Deterministic, locally-computed nudges (top 4, most useful first). */
  readonly recommendations: Signal<DashboardRecommendation[]> = computed(() => {
    const recs: DashboardRecommendation[] = [];
    const s      = this.stats();
    const streak = this.auth.userProfile()?.stats?.currentStreak ?? 0;
    const open   = this.tasks.tasks().filter(t => this.isOpen(t));
    const undated = open.filter(t => !t.dueDate && !t.parentId).length;

    if (s.overdue > 0) {
      recs.push({
        id: 'overdue', tone: 'warning', icon: '⏰',
        title: `Clear ${s.overdue} overdue ${this.plural(s.overdue, 'task')}`,
        body: 'Reschedule or complete these to get back on track.',
        route: '/tasks', cta: 'Review overdue',
      });
    }

    const openToday = this.tasks.todayTasks().filter(t => this.isOpen(t)).length;
    if (openToday > 0) {
      recs.push({
        id: 'today', tone: 'info', icon: '🎯',
        title: `${openToday} ${this.plural(openToday, 'task')} due today`,
        body: 'Knock these out before the day fills up.',
        route: '/tasks', cta: 'Open today',
      });
    }

    if (s.inProgress >= 3) {
      recs.push({
        id: 'wip', tone: 'warning', icon: '🧵',
        title: `${s.inProgress} tasks in progress`,
        body: 'Finish some before starting new work to avoid context-switching.',
        route: '/tasks',
      });
    }

    if (undated >= 3) {
      recs.push({
        id: 'undated', tone: 'info', icon: '📅',
        title: `${undated} tasks have no due date`,
        body: 'Add deadlines so nothing slips through the cracks.',
        route: '/tasks', cta: 'Add dates',
      });
    }

    if (streak >= 3) {
      recs.push({
        id: 'streak', tone: 'success', icon: '🔥',
        title: `${streak}-day streak`,
        body: 'Complete at least one task today to keep it alive.',
      });
    }

    if (!recs.length) {
      recs.push({
        id: 'clear', tone: 'success', icon: '✨',
        title: "You're all caught up",
        body: 'No overdue or due-today tasks. Great time to plan ahead.',
        route: '/calendar', cta: 'Plan week',
      });
    }

    return recs.slice(0, 4);
  });

  // ---- Productivity Score ---------------------------------------------

  /**
   * A 0–100 composite score. Deterministic and explainable via
   * `breakdown`. Baseline 20; completion rate is the largest factor;
   * overdue tasks are the only penalty; streaks add a small bonus.
   */
  readonly productivityScore: Signal<ProductivityScore> = computed(() => {
    const s      = this.stats();
    const streak = this.auth.userProfile()?.stats?.currentStreak ?? 0;

    const todayTasks = this.tasks.todayTasks();
    const todayDone  = todayTasks.filter(t => t.status === 'completed').length;
    const todayRatio = todayTasks.length ? todayDone / todayTasks.length : 1;

    const completion   = Math.round(s.rate * 0.45);            // 0–45
    const todayProgress = Math.round(todayRatio * 20);         // 0–20
    const streakBonus  = Math.min(streak * 3, 15);             // 0–15
    const overduePenalty = -Math.min(s.overdue * 4, 25);       // 0 – -25

    const value = this.clamp(20 + completion + todayProgress + streakBonus + overduePenalty, 0, 100);

    return {
      value,
      label: value >= 80 ? 'Excellent' : value >= 60 ? 'Good' : value >= 40 ? 'Fair' : 'Needs focus',
      breakdown: { completion, todayProgress, overdue: overduePenalty, streak: streakBonus },
    };
  });

  // ---- Internal helpers -----------------------------------------------

  /** Open = actionable: not completed and not cancelled. */
  private isOpen(t: Task): boolean {
    return t.status !== 'completed' && t.status !== 'cancelled';
  }

  private startOfDay(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  private inRange(ms: number | undefined, start: number, end: number): boolean {
    return ms !== undefined && ms >= start && ms < end;
  }

  private clamp(n: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, n));
  }

  private plural(n: number, word: string): string {
    return n === 1 ? word : `${word}s`;
  }

  /** Composite sort key: lower = more urgent. */
  private focusKey(t: Task, now: number): number {
    const due = t.dueDate ? t.dueDate.toMillis() : Infinity;
    let group = 2;                                   // future / undated
    if (due < now) group = 0;                        // overdue
    else if (due < now + DAY_MS) group = 1;          // due within 24h
    // group (×1e15) ≫ priority (×1e12) ≫ due timestamp — strict tie-break order.
    return group * 1e15 + PRIORITY_RANK[t.priority] * 1e12 + (due === Infinity ? 0.999e12 : due);
  }

  private focusReason(t: Task, now: number): string {
    const priority = t.priority.charAt(0).toUpperCase() + t.priority.slice(1);
    if (!t.dueDate) return `${priority} priority`;
    const due = t.dueDate.toMillis();
    if (due < now)            return `Overdue • ${priority}`;
    if (due < now + DAY_MS)   return `Due today • ${priority}`;
    const days = Math.ceil((due - now) / DAY_MS);
    return `Due in ${days} ${this.plural(days, 'day')} • ${priority}`;
  }

}
