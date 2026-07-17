import { Injectable, inject } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { TaskService } from './task.service';
import { AuthService } from './auth.service';
import { DashboardService } from './dashboard.service';
import { AiDashboardService } from './ai-dashboard.service';
import { Task } from '@shared/models/task.model';
import {
  DailyBrief, BriefMeeting, BriefWorkload, BriefWorkItem, WorkloadLevel,
} from '@shared/models/daily-brief.model';

// ============================================================
// DailyBriefService
// ------------------------------------------------------------
// Builds the structured "AI Daily Brief": today's overview, important
// tasks, meetings, overdue items, suggested focus, estimated workload,
// and a recommended working order.
//
// Composition over duplication:
//  • The narrative OVERVIEW reuses AiDashboardService.morningBrief(),
//    which already reuses the existing `transformText` AI endpoint and
//    falls back to a deterministic local summary. No new APIs.
//  • Every other section is derived deterministically from the live
//    Task / Dashboard signals — so the brief is ALWAYS fully populated,
//    even with AI unavailable (satisfies "generate deterministic
//    summaries locally").
//  • Opens NO Firestore listeners; short-TTL cached like the AI briefs.
// ============================================================

const DAY_MS = 86_400_000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const PRIORITY_RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3 };
const MEETING_KEYWORDS = [
  'meeting', 'meet', 'call', 'sync', 'standup', 'stand-up', '1:1', 'one-on-one',
  'interview', 'demo', 'review', 'catch up', 'catchup', 'huddle', 'conference',
  'zoom', 'hangout', 'webinar', 'presentation',
];

@Injectable({ providedIn: 'root' })
export class DailyBriefService {
  private readonly tasks = inject(TaskService);
  private readonly auth  = inject(AuthService);
  private readonly dash  = inject(DashboardService);
  private readonly ai    = inject(AiDashboardService);

  private cached?: DailyBrief;
  private inflight?: Promise<DailyBrief>;

  /**
   * Produce today's brief. Cached for 10 minutes; pass `{ force: true }`
   * to regenerate (also forces a fresh AI overview).
   */
  generate(opts?: { force?: boolean }): Promise<DailyBrief> {
    const force = opts?.force ?? false;

    if (!force && this.cached && Date.now() - this.cached.generatedAt < CACHE_TTL_MS) {
      return Promise.resolve(this.cached);
    }
    if (this.inflight && !force) return this.inflight;

    this.inflight = this.build(force).finally(() => { this.inflight = undefined; });
    return this.inflight;
  }

  /** Drop the cached brief (e.g. after a bulk edit). */
  invalidate(): void { this.cached = undefined; }

  // ---- Assembly -------------------------------------------------------

  private async build(force: boolean): Promise<DailyBrief> {
    const now  = Date.now();
    const open = this.tasks.tasks().filter(t => this.isOpen(t));

    // Overview reuses the AI morning brief (AI → local fallback inside).
    const overview = await this.ai.morningBrief({ force });

    const overdueItems = [...this.tasks.overdueTasks()]
      .sort((a, b) => (a.dueDate?.seconds ?? 0) - (b.dueDate?.seconds ?? 0))
      .slice(0, 10);

    const importantTasks = open
      .filter(t => t.priority === 'urgent' || t.priority === 'high')
      .sort((a, b) => this.urgency(a, now) - this.urgency(b, now))
      .slice(0, 5);

    const brief: DailyBrief = {
      dateLabel: new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
      overview,
      importantTasks,
      meetings:       this.detectMeetings(),
      overdueItems,
      suggestedFocus: this.dash.focusTask(),
      workload:       this.estimateWorkload(),
      workingOrder:   this.recommendOrder(now),
      source:         overview.source,
      generatedAt:    Date.now(),
    };

    this.cached = brief;
    return brief;
  }

  // ---- Meetings -------------------------------------------------------

  /** Detect meeting-like, time-bound items scheduled for today. */
  private detectMeetings(): BriefMeeting[] {
    return this.tasks.todayTasks()
      .map(task => {
        const block = this.todayTimeBlock(task);
        const isMeeting = !!block || (!!task.dueTime && this.looksLikeMeeting(task.title));
        if (!isMeeting) return null;

        const time = task.dueTime ?? (block ? this.formatTime(block) : 'All day');
        return { task, time, timeMinutes: this.timeToMinutes(time) } as BriefMeeting;
      })
      .filter((m): m is BriefMeeting => m !== null)
      .sort((a, b) => a.timeMinutes - b.timeMinutes);
  }

  private looksLikeMeeting(title: string): boolean {
    const lower = title.toLowerCase();
    return MEETING_KEYWORDS.some(kw => lower.includes(kw));
  }

  /** First timeblock whose start falls on today, if any. */
  private todayTimeBlock(task: Task): Timestamp | null {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const startMs = start.getTime();
    for (const b of task.timeBlocks ?? []) {
      const ms = b.startTime?.toMillis?.();
      if (ms !== undefined && ms >= startMs && ms < startMs + DAY_MS) return b.startTime;
    }
    return null;
  }

  // ---- Workload -------------------------------------------------------

  private estimateWorkload(): BriefWorkload {
    // In scope for "today": due today or overdue and still open, deduped.
    const scope = new Map<string, Task>();
    for (const t of this.tasks.todayTasks()) if (this.isOpen(t)) scope.set(t.id, t);
    for (const t of this.tasks.overdueTasks())                   scope.set(t.id, t);
    const list = [...scope.values()];

    const estimatedHours = Math.round(
      list.reduce((sum, t) => sum + (t.estimatedHours ?? 0), 0) * 10
    ) / 10;
    const capacityHours = this.capacityHours();
    const utilization   = capacityHours > 0 && estimatedHours > 0
      ? Math.round((estimatedHours / capacityHours) * 100) : 0;

    const level = this.workloadLevel(list.length, estimatedHours, utilization);
    return {
      taskCount: list.length, estimatedHours, capacityHours, utilization, level,
      summary: this.workloadSummary(level, list.length, estimatedHours),
    };
  }

  private workloadLevel(count: number, hours: number, utilization: number): WorkloadLevel {
    if (count === 0) return 'light';
    // Prefer hour-based classification when estimates exist.
    if (hours > 0) {
      if (utilization > 120) return 'overloaded';
      if (utilization >= 90) return 'heavy';
      if (utilization >= 50) return 'moderate';
      return 'light';
    }
    // No estimates → classify by task count.
    if (count > 10) return 'overloaded';
    if (count > 6)  return 'heavy';
    if (count > 3)  return 'moderate';
    return 'light';
  }

  private workloadSummary(level: WorkloadLevel, count: number, hours: number): string {
    const label = level.charAt(0).toUpperCase() + level.slice(1);
    const tasks = `${count} ${count === 1 ? 'task' : 'tasks'}`;
    return hours > 0 ? `${label} — ~${hours}h across ${tasks}` : `${label} — ${tasks}`;
  }

  /** Working-hours capacity from user prefs (default 8h). */
  private capacityHours(): number {
    const wh = this.auth.userProfile()?.preferences?.workingHours;
    if (!wh?.start || !wh?.end) return 8;
    const diff = (this.timeToMinutes(wh.end) - this.timeToMinutes(wh.start)) / 60;
    return diff > 0 ? Math.round(diff * 10) / 10 : 8;
  }

  // ---- Recommended working order --------------------------------------

  private recommendOrder(now: number): BriefWorkItem[] {
    // Overdue + due-today + focus candidates, deduped, urgency-ordered.
    const scope = new Map<string, Task>();
    for (const t of this.tasks.overdueTasks())                   scope.set(t.id, t);
    for (const t of this.tasks.todayTasks()) if (this.isOpen(t)) scope.set(t.id, t);
    const focus = this.dash.focusTask();
    if (focus) scope.set(focus.task.id, focus.task);

    return [...scope.values()]
      .filter(t => this.isOpen(t))
      .sort((a, b) => this.urgency(a, now) - this.urgency(b, now))
      .slice(0, 8)
      .map(task => ({ task, reason: this.orderReason(task, now) }));
  }

  private orderReason(t: Task, now: number): string {
    const due = t.dueDate ? t.dueDate.toMillis() : Infinity;
    if (due < now)          return 'Overdue — do first';
    if (due < now + DAY_MS) return 'Due today';
    if (t.priority === 'urgent' || t.priority === 'high') return 'High priority';
    return 'Scheduled';
  }

  // ---- Helpers --------------------------------------------------------

  private isOpen(t: Task): boolean {
    return t.status !== 'completed' && t.status !== 'cancelled';
  }

  private urgency(t: Task, now: number): number {
    const due = t.dueDate ? t.dueDate.toMillis() : Infinity;
    let group = 2;
    if (due < now) group = 0;
    else if (due < now + DAY_MS) group = 1;
    return group * 1e15 + PRIORITY_RANK[t.priority] * 1e12 + (due === Infinity ? 0.999e12 : due);
  }

  private formatTime(ts: Timestamp): string {
    const d = ts.toDate();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  private timeToMinutes(time: string): number {
    if (time === 'All day') return 24 * 60 + 1;
    const [h, m] = time.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  }
}
