import { Timestamp } from '@angular/fire/firestore';

// ============================================================
// Schedule & Insight Models
// ============================================================

export interface ScheduledBlock {
  id:           string;
  userId:       string;
  taskId:       string;

  startTime:    Timestamp;
  endTime:      Timestamp;

  /** Was auto-scheduled by AI */
  autoScheduled: boolean;
  /** Calendar event ID if synced */
  calendarEventId?: string;
  provider?:    'google' | 'microsoft';

  /** Conflict state */
  hasConflict:  boolean;
  conflictWith?: string[];   // other schedule block IDs

  createdAt:    Timestamp;
  updatedAt:    Timestamp;
}

export type InsightType =
  | 'overbooked'
  | 'delay_pattern'
  | 'completion_trend'
  | 'category_imbalance'
  | 'missed_tasks'
  | 'focus_time'
  | 'peak_productivity'
  | 'workload_warning';

export interface Insight {
  id:        string;
  userId:    string;
  type:      InsightType;

  title:     string;
  body:      string;
  /** Emoji or icon name */
  icon:      string;

  /** Optional action button */
  action?: {
    label:   string;
    command: string;  // chat command to execute
  };

  /** Related entity IDs */
  relatedTaskIds?:     string[];
  relatedCategoryIds?: string[];

  severity:  'info' | 'warning' | 'critical';
  read:      boolean;
  dismissed: boolean;

  createdAt: Timestamp;
  expiresAt: Timestamp;
}

export interface DaySchedule {
  date:   Date;
  blocks: Array<{
    block:  ScheduledBlock;
    task?:  import('./task.model').Task;
  }>;
  totalScheduledMinutes: number;
  freeSlots:             TimeSlot[];
  isOverbooked:          boolean;
}

export interface TimeSlot {
  start:          Date;
  end:            Date;
  durationMinutes: number;
}
