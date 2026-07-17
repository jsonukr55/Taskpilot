import { Task } from './task.model';
import { FocusTask } from './dashboard.model';
import { AiBrief } from './ai-brief.model';

// ============================================================
// Daily Brief Models — the structured "start of day" briefing.
// Assembled by DailyBriefService from existing signals + the AI
// narrative overview (which degrades to a local summary). Every
// section is deterministic except `overview`, so the brief is always
// fully populated even when AI is unavailable.
// ============================================================

/** A meeting-like, time-bound item detected for today. */
export interface BriefMeeting {
  task: Task;
  /** 'HH:mm' start time, or 'All day' when only a due date is known. */
  time: string;
  /** Minutes since midnight, for sorting ('All day' sinks to the end). */
  timeMinutes: number;
}

export type WorkloadLevel = 'light' | 'moderate' | 'heavy' | 'overloaded';

/** Estimated workload for the day vs. available capacity. */
export interface BriefWorkload {
  /** Open tasks in scope for today (due-today + overdue, deduped). */
  taskCount:      number;
  /** Sum of estimated hours across those tasks (0 when unestimated). */
  estimatedHours: number;
  /** Available working hours derived from the user's working-hours pref. */
  capacityHours:  number;
  /** estimatedHours / capacity, as a percentage (may exceed 100). */
  utilization:    number;
  level:          WorkloadLevel;
  /** Short human summary, e.g. "Heavy — ~7h across 6 tasks". */
  summary:        string;
}

/** One entry in the recommended working order, with a why. */
export interface BriefWorkItem {
  task:   Task;
  reason: string;
}

/** The full daily brief. */
export interface DailyBrief {
  dateLabel:      string;
  /** Narrative overview (AI when available, deterministic otherwise). */
  overview:       AiBrief;
  importantTasks: Task[];
  meetings:       BriefMeeting[];
  overdueItems:   Task[];
  suggestedFocus: FocusTask | null;
  workload:       BriefWorkload;
  workingOrder:   BriefWorkItem[];
  /** Convenience mirror of `overview.source`. */
  source:         'ai' | 'local';
  generatedAt:    number;
}
