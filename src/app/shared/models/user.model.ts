import { Timestamp } from '@angular/fire/firestore';

// ============================================================
// User Model
// ============================================================

export interface CalendarIntegration {
  provider:      'google' | 'microsoft';
  connected:     boolean;
  accessToken?:  string;   // encrypted at rest via Cloud Functions
  refreshToken?: string;
  calendarId?:   string;
  lastSynced?:   Timestamp | null;
}

export interface UserPreferences {
  theme:              'light' | 'dark' | 'system';
  timezone:           string;       // IANA timezone e.g. 'America/New_York'
  weekStartsOn:       0 | 1;        // 0=Sun, 1=Mon
  defaultView:        'list' | 'board' | 'calendar';
  workingHours:       { start: string; end: string };
  notificationsEnabled: boolean;
  soundEnabled:       boolean;
  aiAutoSchedule:     boolean;
  aiAutoCategory:     boolean;
  language:           string;       // 'en', 'es', etc.
  dateFormat:         'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
}

export interface UserStats {
  totalTasks:       number;
  completedTasks:   number;
  totalCategories:  number;
  currentStreak:    number;        // days in a row with completed tasks
  longestStreak:    number;
  lastActiveDate?:  Timestamp | null;
}

export interface UserProfile {
  uid:         string;
  email:       string;
  displayName: string;
  photoURL?:   string | null;

  preferences: UserPreferences;
  stats:       UserStats;

  calendarIntegrations: CalendarIntegration[];

  /** Last seen AI insight IDs to avoid re-showing */
  seenInsightIds: string[];

  createdAt:   Timestamp;
  updatedAt:   Timestamp;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme:              'system',
  timezone:           Intl.DateTimeFormat().resolvedOptions().timeZone,
  weekStartsOn:       1,
  defaultView:        'list',
  workingHours:       { start: '09:00', end: '18:00' },
  notificationsEnabled: true,
  soundEnabled:       true,
  aiAutoSchedule:     true,
  aiAutoCategory:     true,
  language:           'en',
  dateFormat:         'MM/DD/YYYY'
};
