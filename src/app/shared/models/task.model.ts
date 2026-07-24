import { Timestamp } from '@angular/fire/firestore';

// ============================================================
// Task Model — Core data structure
// ============================================================

export type TaskStatus    = 'todo' | 'in_progress' | 'completed' | 'cancelled';
export type TaskPriority  = 'low' | 'medium' | 'high' | 'urgent';

// Monday-style workflow stage (the board's "Status" column). The coarse
// `status` above is DERIVED from this so completion logic stays intact.
export type TaskStage = 'created' | 'in_discussion' | 'development' | 'done' | 'released' | 'production';

export const TASK_STAGES: { value: TaskStage; label: string }[] = [
  { value: 'created',       label: 'Created' },
  { value: 'in_discussion', label: 'In Discussion' },
  { value: 'development',   label: 'Development' },
  { value: 'done',          label: 'Done' },
  { value: 'released',      label: 'Released' },
  { value: 'production',    label: 'Production' },
];

export const TASK_STAGE_LABELS: Record<TaskStage, string> =
  Object.fromEntries(TASK_STAGES.map(s => [s.value, s.label])) as Record<TaskStage, string>;

/** Coarse completion status derived from the workflow stage. */
export function statusForStage(stage: TaskStage): TaskStatus {
  switch (stage) {
    case 'development':                          return 'in_progress';
    case 'done': case 'released': case 'production': return 'completed';
    default:                                     return 'todo';   // created, in_discussion
  }
}
export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly' | 'custom';

export interface AiMetadata {
  /** 0–1 confidence of AI extraction */
  confidence:           number;
  /** Original raw text used to generate this task */
  sourceText?:          string;
  /** How the task was created */
  extractionMethod:     'text' | 'image' | 'voice' | 'manual' | 'chat';
  /** Model used for extraction */
  model?:               string;
  /** AI-generated scheduling suggestion */
  schedulingSuggestion?: string;
  /** AI-detected entities from input */
  detectedEntities?:    string[];
  /** Whether AI detected an implicit deadline */
  implicitDeadline?:    boolean;
}

export interface Recurrence {
  type:        RecurrenceType;
  interval?:   number;        // every N days/weeks
  daysOfWeek?: number[];      // 0=Sun, 6=Sat
  endsAt?:     Timestamp | null;
}

export interface TimeBlock {
  startTime:   Timestamp;
  endTime:     Timestamp;
  calendarEventId?: string;   // linked calendar event
  provider?:   'google' | 'microsoft';
}

export interface ChecklistItem {
  id:          string;
  text:        string;
  completed:   boolean;
  completedAt?: Timestamp | null;
}

export interface Task {
  id:              string;
  userId:          string;   // creator / personal owner

  // Collaboration (optional — personal tasks leave these unset)
  groupId?:        string | null;   // null/absent = personal task
  assigneeIds?:    string[];        // group member uids assigned to this task

  // Organization / Space scoping (optional — parallel to groupId).
  // A space task carries both so it can be queried by space and its
  // parent org resolved without an extra read.
  orgId?:          string | null;
  spaceId?:        string | null;   // null/absent = not a space task
  spaceGroupId?:   string | null;   // board section within the space (Monday "Group")
  position?:       number;          // order within its board section
  stage?:          TaskStage;       // workflow stage (board Status column)
  sprint?:         string | null;   // sprint label (e.g. "Sprint 1")
  customFields?:   Record<string, string | number | null>;  // space custom column values

  // Core fields
  title:           string;
  description?:    string;
  status:          TaskStatus;
  priority:        TaskPriority;

  // Dates
  startDate?:      Timestamp | null;
  dueDate?:        Timestamp | null;
  dueTime?:        string | null;    // 'HH:mm' format
  completedAt?:    Timestamp | null;

  // Effort
  estimatedHours?: number | null;
  actualHours?:    number | null;

  // Hierarchy
  parentId?:       string | null;

  // Organization
  categoryIds:     string[];
  tags:            string[];
  checklist:       ChecklistItem[];

  // Scheduling
  timeBlocks:      TimeBlock[];
  recurrence?:     Recurrence | null;
  isScheduled:     boolean;

  // AI metadata
  aiMetadata?:     AiMetadata | null;

  // Attachments
  imageUrl?:       string | null;

  // Timestamps
  createdAt:       Timestamp;
  updatedAt:       Timestamp;

  // Reminders
  reminders:       TaskReminder[];
}

export interface TaskReminder {
  id:        string;
  minutesBefore: number;
  sent:      boolean;
}

// DTO for creating a task (no id/timestamps yet)
export type CreateTaskDto = Omit<Task, 'id' | 'createdAt' | 'updatedAt'>;

// Form model (dates as Date objects for form binding)
export interface TaskFormData {
  title:          string;
  description:    string;
  status:         TaskStatus;
  priority:       TaskPriority;
  startDate:      Date | null;
  dueDate:        Date | null;
  dueTime:        string;
  estimatedHours: number | null;
  categoryIds:    string[];
  tags:           string[];
  recurrenceType: RecurrenceType;
}

// AI-extracted task fields
export interface AiExtractedTask {
  title:           string;
  description?:    string;
  priority?:       TaskPriority;
  startDate?:      Date | null;
  dueDate?:        Date | null;
  dueTime?:        string | null;
  estimatedHours?: number | null;
  categoryName?:   string;
  tags?:           string[];
  confidence:      number;
  schedulingSuggestion?: string;
}
