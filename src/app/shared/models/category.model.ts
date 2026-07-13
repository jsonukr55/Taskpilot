import { Timestamp } from '@angular/fire/firestore';

// ============================================================
// Category Model
// ============================================================

export interface CategoryRule {
  /** Preferred working hours e.g. { start: '09:00', end: '17:00' } */
  preferredHours?:  { start: string; end: string };
  /** Days of week this category applies to (0=Sun, 6=Sat) */
  workDays?:        number[];
  /** Default priority bias when AI assigns this category */
  priorityBias?:    'low' | 'medium' | 'high';
  /** Reminder offsets in minutes */
  reminderMinutes?: number[];
  /** Auto-archive completed tasks after N days */
  autoArchiveDays?: number;
  /** Max tasks scheduled per day */
  maxDailyTasks?:   number;
}

export interface Category {
  id:          string;
  userId:      string;

  name:        string;
  description?: string;
  icon:        string;    // emoji or icon name
  color:       string;    // hex color

  /** Parent category id for hierarchy */
  parentId?:   string | null;

  /** AI auto-detection keywords */
  keywords?:   string[];

  /** Category-specific rules */
  rules:       CategoryRule;

  /** Order for sorting */
  order:       number;

  createdAt:   Timestamp;
  updatedAt:   Timestamp;
}

// Built-in default categories
export const DEFAULT_CATEGORIES: Omit<Category, 'id' | 'userId' | 'createdAt' | 'updatedAt'>[] = [
  {
    name: 'Work',
    description: 'Professional tasks and projects',
    icon: '💼',
    color: '#6366f1',
    parentId: null,
    keywords: ['meeting', 'deadline', 'project', 'client', 'report', 'email', 'presentation'],
    order: 0,
    rules: {
      preferredHours: { start: '09:00', end: '18:00' },
      workDays: [1, 2, 3, 4, 5],
      priorityBias: 'high',
      reminderMinutes: [30, 1440]
    }
  },
  {
    name: 'Personal',
    description: 'Personal errands and life tasks',
    icon: '🏠',
    color: '#10b981',
    parentId: null,
    keywords: ['buy', 'pick up', 'call', 'appointment', 'family', 'home'],
    order: 1,
    rules: {
      preferredHours: { start: '08:00', end: '21:00' },
      workDays: [0, 1, 2, 3, 4, 5, 6],
      priorityBias: 'medium',
      reminderMinutes: [60]
    }
  },
  {
    name: 'Health',
    description: 'Fitness, medical, and wellness',
    icon: '🏃',
    color: '#f59e0b',
    parentId: null,
    keywords: ['gym', 'workout', 'doctor', 'medication', 'exercise', 'yoga', 'run', 'walk'],
    order: 2,
    rules: {
      preferredHours: { start: '06:00', end: '20:00' },
      workDays: [0, 1, 2, 3, 4, 5, 6],
      priorityBias: 'medium',
      reminderMinutes: [30]
    }
  },
  {
    name: 'Learning',
    description: 'Study, courses, and skill development',
    icon: '📚',
    color: '#8b5cf6',
    parentId: null,
    keywords: ['read', 'study', 'course', 'learn', 'practice', 'review', 'tutorial'],
    order: 3,
    rules: {
      preferredHours: { start: '07:00', end: '22:00' },
      workDays: [0, 1, 2, 3, 4, 5, 6],
      priorityBias: 'medium',
      reminderMinutes: [15]
    }
  },
  {
    name: 'Finance',
    description: 'Bills, budgeting, and financial tasks',
    icon: '💰',
    color: '#f43f5e',
    parentId: null,
    keywords: ['pay', 'bill', 'invoice', 'budget', 'tax', 'invest', 'bank', 'expense'],
    order: 4,
    rules: {
      preferredHours: { start: '09:00', end: '18:00' },
      workDays: [1, 2, 3, 4, 5],
      priorityBias: 'high',
      reminderMinutes: [1440, 4320]
    }
  }
];
