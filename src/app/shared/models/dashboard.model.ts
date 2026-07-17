import { Task } from './task.model';
import { Category } from './category.model';

// ============================================================
// Dashboard Models — shared shapes for the dashboard intelligence
// layer. These are pure view-models derived from existing service
// signals (TaskService / CategoryService / AuthService); they add
// NO new Firestore state of their own.
// ============================================================

/** Headline counters shown in the dashboard stat cards. */
export interface DashboardStats {
  total:     number;
  today:     number;
  overdue:   number;
  completed: number;
  /** Overall completion rate, 0–100. */
  rate:      number;
  inProgress: number;
}

/**
 * The single task the user should tackle next, plus a human reason.
 * `null` when there is nothing actionable.
 */
export interface FocusTask {
  task:   Task;
  /** Why this task was chosen (e.g. "Overdue & high priority"). */
  reason: string;
}

/** Per-category progress row. */
export interface CategoryProgress {
  category: Category;
  count:    number;
  done:     number;
  /** Completion percentage for this category, 0–100. */
  percent:  number;
}

/** One day in the rolling weekly productivity summary. */
export interface WeeklyDay {
  date:      Date;
  label:     string;   // 'Mon', 'Tue', …
  isToday:   boolean;
  created:   number;
  completed: number;
}

/** Rolling 7-day productivity summary. */
export interface WeeklyProductivity {
  days:            WeeklyDay[];
  completedThisWeek: number;
  createdThisWeek:   number;
  /** Busiest completion count across the week (>= 1 for safe bar math). */
  peakCompleted:   number;
  /** Average completed-per-day over the 7-day window, rounded to 0.1. */
  avgPerDay:       number;
  /** Completed-this-week vs the prior 7 days, as a signed percentage. */
  trendPercent:    number;
}

export type RecommendationTone = 'info' | 'warning' | 'success';

/** A deterministic, locally-computed productivity nudge. */
export interface DashboardRecommendation {
  id:    string;
  icon:  string;
  title: string;
  body:  string;
  tone:  RecommendationTone;
  /** Optional in-app route the CTA should navigate to. */
  route?: string;
  cta?:   string;
}

/** Composite productivity score with a breakdown for transparency. */
export interface ProductivityScore {
  /** 0–100 overall score. */
  value:  number;
  /** Bucketed label for quick display. */
  label:  'Excellent' | 'Good' | 'Fair' | 'Needs focus';
  /** Signed contribution of each factor (for tooltips / debugging). */
  breakdown: {
    completion:  number;
    todayProgress: number;
    overdue:     number;
    streak:      number;
  };
}
