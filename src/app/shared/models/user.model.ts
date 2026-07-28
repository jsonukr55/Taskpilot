import { Timestamp } from '@angular/fire/firestore';
import { NoteAccessState } from './note.model';

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
  accentColor:        string;        // hex, e.g. '#6366f1' — drives the app accent
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

  /** Startup screen: a Space the user opens first on login. null = default
   *  (dashboard). Optional so pre-existing profiles need no migration. */
  startupSpaceId?:    string | null;
  startupOrgId?:      string | null;   // parent org, to build the route
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

  /** Platform-level role. Absent/undefined = regular user.
   *   • 'admin'       = Owner (top tier; can manage clients + grant Owner)
   *   • 'superglobal' = below Owner; all platform access except client CRUD
   *                     and granting/modifying Owners.
   *  Both grant the admin panel. Written server-side — never from the client. */
  globalRole?: 'admin' | 'superglobal';

  preferences: UserPreferences;
  stats:       UserStats;

  calendarIntegrations: CalendarIntegration[];

  /** Last seen AI insight IDs to avoid re-showing */
  seenInsightIds: string[];

  /** Note quick-access state (favorites/pins/recents). Optional —
   *  pre-existing profiles lack it; readers must fall back to empty. */
  noteAccess?: NoteAccessState;

  createdAt:   Timestamp;
  updatedAt:   Timestamp;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme:              'system',
  accentColor:        '#6366f1',
  timezone:           Intl.DateTimeFormat().resolvedOptions().timeZone,
  weekStartsOn:       1,
  defaultView:        'list',
  workingHours:       { start: '09:00', end: '18:00' },
  notificationsEnabled: true,
  soundEnabled:       true,
  aiAutoSchedule:     true,
  aiAutoCategory:     true,
  language:           'en',
  dateFormat:         'MM/DD/YYYY',
  startupSpaceId:     null,
  startupOrgId:       null
};
