// ============================================================
// Release notes — the content shown on the "What's New" page.
// Newest version first. Bump the top entry's `version` whenever
// you ship; the sidebar shows a "New" dot until the user opens it.
// ============================================================

export type ReleaseNoteType = 'added' | 'improved' | 'fixed';

export interface ReleaseNoteItem {
  type: ReleaseNoteType;
  text: string;
}

export interface ReleaseNote {
  version: string;   // e.g. 'v0.2'
  date:    string;   // 'YYYY-MM-DD'
  title?:  string;   // optional headline
  items:   ReleaseNoteItem[];
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: 'v0.3',
    date:    '2026-07-17',
    title:   'Smarter & faster',
    items: [
      { type: 'added',    text: 'Smarter dashboard — Today’s Focus task, a Productivity Score, a weekly summary, smart recommendations, recent activity and recently-completed at a glance.' },
      { type: 'added',    text: 'Bulk task actions — select multiple tasks to complete, restore, archive, delete, or set priority, category and due date at once.' },
      { type: 'added',    text: 'Keyboard shortcuts everywhere — press “?” to see them all. Ctrl/⌘+K to search, N for a new task, arrow keys to navigate, E to edit, D to duplicate, Ctrl/⌘+S to save.' },
      { type: 'added',    text: 'Smart filters — one-click Quick filters (My Tasks, Due Today, Overdue, High Priority, Recently Updated, Completed This Week) plus Saved and Recent filters.' },
      { type: 'added',    text: 'Favorite & pin notes, plus a Quick Access strip and Recently Opened, so your important notes are always one click away.' },
      { type: 'added',    text: 'Activity feed — see recent task, note and group activity on the dashboard and on each group.' },
      { type: 'improved', text: 'More AI writing skills in notes — Rewrite, Translate, Professional tone, Bullet points, Extract action items, Meeting summary and Email draft, inserted as clean, formatted blocks.' },
      { type: 'fixed',    text: 'Switching directly between two notes now loads the right note instead of keeping the previous one open.' },
    ],
  },
  {
    version: 'v0.2',
    date:    '2026-07-14',
    title:   'Personalization & polish',
    items: [
      { type: 'added',    text: 'Theme accent color picker — choose from 12 presets or any custom color, applied across the whole app.' },
      { type: 'added',    text: 'Daily Report lines now save to My Tasks — progress becomes completed tasks, plans become to-dos, tagged “daily-report”.' },
      { type: 'added',    text: 'Daily Report remembers your last-selected team between visits.' },
      { type: 'improved', text: 'Redesigned every dropdown with a custom, theme-aware picker (icons, checkmarks, keyboard support).' },
      { type: 'improved', text: 'New neutral charcoal dark theme and Plus Jakarta Sans as the app font.' },
      { type: 'improved', text: 'Cleaner, solid primary buttons.' },
    ],
  },
  {
    version: 'v0.1',
    date:    '2026-07-01',
    title:   'First release',
    items: [
      { type: 'added', text: 'Tasks, Categories, Notes, Groups, Calendar, and Daily Reports.' },
      { type: 'added', text: 'Light / dark / system theme with per-user preferences.' },
      { type: 'added', text: 'Rich Teams-ready daily report export.' },
    ],
  },
];
