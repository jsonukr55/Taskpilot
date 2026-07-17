import { Task } from './task.model';
import {
  FocusTask, CategoryProgress, WeeklyProductivity,
  ActivityEvent, DashboardRecommendation, ProductivityScore, DashboardStats
} from './dashboard.model';
import { RiskFlag } from './ai-brief.model';

// ============================================================
// Dashboard Widget Models
// ------------------------------------------------------------
// A widget is an INDEPENDENT, self-describing unit of the dashboard.
// Each one is produced by DashboardWidgetsService as a single
// `Signal<DashboardWidget<T>>`, so Developer 1 can render any subset
// in any order / layout without coupling widgets to each other or to
// the underlying services.
//
// Every widget carries its own presentation metadata (title/icon/
// description), a lifecycle `status` (loading → ready/empty), and a
// strongly-typed `data` payload. Nothing here reads Firestore; all
// data flows from the existing DashboardService / AiDashboardService
// signals.
// ============================================================

/** Stable identifiers for every available widget. */
export type WidgetId =
  | 'focus'
  | 'upcoming'
  | 'activity'
  | 'productivity'
  | 'insights'
  | 'calendar'
  | 'goal'
  | 'category'
  | 'completed';

export type WidgetStatus = 'loading' | 'ready' | 'empty';

/** Optional "view all →" affordance a widget can surface. */
export interface WidgetLink {
  label: string;
  route: string;
}

/**
 * The uniform envelope every widget shares. `T` is the widget's
 * specific data shape. Consumers switch on `status` for skeleton /
 * empty / content rendering and read `data` when `status === 'ready'`.
 */
export interface DashboardWidget<T> {
  id:          WidgetId;
  title:       string;
  /** `tp-icon` name for the header. */
  icon:        string;
  /** Human description — used by a widget picker / a11y labels. */
  description: string;
  status:      WidgetStatus;
  /** Convenience mirror of `status === 'empty'`. */
  isEmpty:     boolean;
  data:        T;
  link?:       WidgetLink;
}

// ---- Per-widget data payloads ---------------------------------------

export interface FocusWidgetData {
  focus: FocusTask | null;
}

export interface UpcomingTasksWidgetData {
  tasks:        Task[];
  overdueCount: number;
}

export interface ActivityWidgetData {
  events: ActivityEvent[];
}

export interface ProductivityWidgetData {
  score: ProductivityScore;
  stats: DashboardStats;
  week:  WeeklyProductivity;
}

export interface InsightsWidgetData {
  recommendations: DashboardRecommendation[];
  risks:           RiskFlag[];
}

/** One timed entry in the calendar/agenda widget. */
export interface AgendaItem {
  task: Task;
  /** 'HH:mm' if the task has a due time, otherwise 'All day'. */
  time: string;
}

export interface CalendarWidgetData {
  today:    AgendaItem[];
  upcoming: Task[];
}

export interface GoalWidgetData {
  /** Short label describing the current goal, e.g. "Finish today's tasks". */
  label:         string;
  target:        number;
  current:       number;
  /** 0–100 progress toward `target`. */
  percent:       number;
  /** Unit noun, e.g. "tasks" or "days". */
  unit:          string;
  streak:        number;
  longestStreak: number;
}

export interface CategoryWidgetData {
  rows: CategoryProgress[];
}

export interface CompletedWidgetData {
  tasks: Task[];
}

// ---- Catalog (for a configurable dashboard / widget picker) ---------

/** Static description of a widget, independent of its live data. */
export interface WidgetDescriptor {
  id:             WidgetId;
  title:          string;
  icon:           string;
  description:    string;
  /** Whether this widget is shown by default on a fresh dashboard. */
  defaultEnabled: boolean;
}

/**
 * The catalog of available widgets. Developer 1 can drive a widget
 * picker / layout editor from this without importing the service.
 */
export const WIDGET_CATALOG: readonly WidgetDescriptor[] = [
  { id: 'focus',        title: "Today's Focus",       icon: 'zap',          description: 'The single most important task to tackle next.',        defaultEnabled: true },
  { id: 'productivity', title: 'Productivity',        icon: 'bar-chart-2',  description: 'Your productivity score and weekly throughput.',        defaultEnabled: true },
  { id: 'insights',     title: 'Insights',            icon: 'sparkles',     description: 'Smart recommendations and detected risks.',             defaultEnabled: true },
  { id: 'upcoming',     title: 'Upcoming Deadlines',  icon: 'calendar',     description: 'Open tasks due within the next 7 days.',                defaultEnabled: true },
  { id: 'calendar',     title: "Today's Agenda",      icon: 'clock',        description: "Today's timed tasks and what's coming up.",             defaultEnabled: true },
  { id: 'activity',     title: 'Recent Activity',     icon: 'repeat',       description: 'A live stream of recent task activity.',                defaultEnabled: true },
  { id: 'goal',         title: 'Daily Goal',          icon: 'flag',         description: 'Progress toward your goal and current streak.',         defaultEnabled: true },
  { id: 'category',     title: 'By Category',         icon: 'layers',       description: 'Completion progress broken down by category.',          defaultEnabled: false },
  { id: 'completed',    title: 'Recently Completed',  icon: 'check-circle', description: 'The tasks you most recently finished.',                 defaultEnabled: false },
] as const;
