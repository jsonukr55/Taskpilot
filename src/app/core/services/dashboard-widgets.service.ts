import { Injectable, inject, computed, Signal } from '@angular/core';
import { TaskService } from './task.service';
import { AuthService } from './auth.service';
import { DashboardService } from './dashboard.service';
import { AiDashboardService } from './ai-dashboard.service';
import { Task } from '@shared/models/task.model';
import {
  DashboardWidget, WidgetStatus,
  FocusWidgetData, UpcomingTasksWidgetData, ActivityWidgetData,
  ProductivityWidgetData, InsightsWidgetData, CalendarWidgetData,
  GoalWidgetData, CategoryWidgetData, CompletedWidgetData, AgendaItem,
} from '@shared/models/dashboard-widget.model';

// ============================================================
// DashboardWidgetsService
// ------------------------------------------------------------
// Assembles the dashboard's independent widgets. Each widget is a
// single `computed()` signal wrapping the existing DashboardService /
// AiDashboardService derivations in a uniform `DashboardWidget<T>`
// envelope (title, icon, status, data). Widgets are fully independent:
// Developer 1 can render any subset, in any layout, and each computes
// lazily/memoised on its own.
//
// Opens NO Firestore listeners — everything derives from live signals.
// ============================================================

const NEXT_STREAK_MILESTONES = [3, 7, 14, 30, 60, 100];

@Injectable({ providedIn: 'root' })
export class DashboardWidgetsService {
  private readonly tasks = inject(TaskService);
  private readonly auth  = inject(AuthService);
  private readonly dash  = inject(DashboardService);
  private readonly ai    = inject(AiDashboardService);

  /** True while the initial task snapshot is still loading. */
  private status(isEmpty: boolean): WidgetStatus {
    if (this.tasks.isLoading()) return 'loading';
    return isEmpty ? 'empty' : 'ready';
  }

  // ---- Focus ----------------------------------------------------------

  readonly focus: Signal<DashboardWidget<FocusWidgetData>> = computed(() => {
    const focus = this.dash.focusTask();
    return this.wrap('focus', "Today's Focus", 'zap',
      'The single most important task to tackle next.',
      { focus }, focus === null);
  });

  // ---- Upcoming Deadlines ---------------------------------------------

  readonly upcoming: Signal<DashboardWidget<UpcomingTasksWidgetData>> = computed(() => {
    const tasks = this.dash.upcomingDeadlines();
    return this.wrap('upcoming', 'Upcoming Deadlines', 'calendar',
      'Open tasks due within the next 7 days.',
      { tasks, overdueCount: this.dash.stats().overdue }, tasks.length === 0,
      { label: 'Calendar', route: '/calendar' });
  });

  // ---- Recent Activity ------------------------------------------------

  readonly activity: Signal<DashboardWidget<ActivityWidgetData>> = computed(() => {
    const events = this.dash.recentActivity();
    return this.wrap('activity', 'Recent Activity', 'repeat',
      'A live stream of recent task activity.',
      { events }, events.length === 0);
  });

  // ---- Productivity ---------------------------------------------------

  readonly productivity: Signal<DashboardWidget<ProductivityWidgetData>> = computed(() => {
    const stats = this.dash.stats();
    return this.wrap('productivity', 'Productivity', 'bar-chart-2',
      'Your productivity score and weekly throughput.',
      { score: this.dash.productivityScore(), stats, week: this.dash.weeklyProductivity() },
      stats.total === 0, { label: 'Analytics', route: '/analytics' });
  });

  // ---- Insights (deterministic: recommendations + risks) --------------

  readonly insights: Signal<DashboardWidget<InsightsWidgetData>> = computed(() => {
    const recommendations = this.dash.recommendations();
    const risks           = this.ai.riskFlags();
    return this.wrap('insights', 'Insights', 'sparkles',
      'Smart recommendations and detected risks.',
      { recommendations, risks }, recommendations.length === 0 && risks.length === 0);
  });

  // ---- Calendar / Agenda ----------------------------------------------

  readonly calendar: Signal<DashboardWidget<CalendarWidgetData>> = computed(() => {
    const today: AgendaItem[] = this.tasks.todayTasks()
      .map(task => ({ task, time: task.dueTime ?? 'All day' }))
      .sort((a, b) => this.timeRank(a) - this.timeRank(b));
    const upcoming = this.dash.upcomingDeadlines();
    return this.wrap('calendar', "Today's Agenda", 'clock',
      "Today's timed tasks and what's coming up.",
      { today, upcoming }, today.length === 0 && upcoming.length === 0,
      { label: 'Calendar', route: '/calendar' });
  });

  // ---- Daily Goal -----------------------------------------------------

  readonly goal: Signal<DashboardWidget<GoalWidgetData>> = computed(() => {
    const stats  = this.dash.stats();
    const streak = this.auth.userProfile()?.stats?.currentStreak ?? 0;
    const longest = this.auth.userProfile()?.stats?.longestStreak ?? 0;

    let data: GoalWidgetData;
    if (stats.today > 0) {
      // Goal = finish everything due today.
      const done = this.tasks.todayTasks().filter(t => t.status === 'completed').length;
      data = {
        label: "Finish today's tasks", target: stats.today, current: done,
        percent: Math.round((done / stats.today) * 100), unit: 'tasks',
        streak, longestStreak: longest,
      };
    } else {
      // No due-today work → goal becomes reaching the next streak milestone.
      const target = NEXT_STREAK_MILESTONES.find(m => m > streak) ?? streak;
      data = {
        label: 'Keep your streak going', target, current: streak,
        percent: target ? Math.round((streak / target) * 100) : 0, unit: 'days',
        streak, longestStreak: longest,
      };
    }

    return this.wrap('goal', 'Daily Goal', 'flag',
      'Progress toward your goal and current streak.',
      data, stats.total === 0);
  });

  // ---- Category Progress ----------------------------------------------

  readonly category: Signal<DashboardWidget<CategoryWidgetData>> = computed(() => {
    const rows = this.dash.categoryProgress();
    return this.wrap('category', 'By Category', 'layers',
      'Completion progress broken down by category.',
      { rows }, rows.length === 0, { label: 'Analytics', route: '/analytics' });
  });

  // ---- Recently Completed ---------------------------------------------

  readonly completed: Signal<DashboardWidget<CompletedWidgetData>> = computed(() => {
    const tasks = this.dash.recentlyCompleted();
    return this.wrap('completed', 'Recently Completed', 'check-circle',
      'The tasks you most recently finished.',
      { tasks }, tasks.length === 0);
  });

  // ---- Helpers --------------------------------------------------------

  /** Build a uniform widget envelope with a derived status. */
  private wrap<T>(
    id: DashboardWidget<T>['id'], title: string, icon: string,
    description: string, data: T, isEmpty: boolean, link?: DashboardWidget<T>['link'],
  ): DashboardWidget<T> {
    return { id, title, icon, description, status: this.status(isEmpty), isEmpty, data, link };
  }

  /** Sort agenda items by time; 'All day' entries sink to the bottom. */
  private timeRank(item: AgendaItem): number {
    if (item.time === 'All day') return 24 * 60 + 1;
    const [h, m] = item.time.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  }
}
