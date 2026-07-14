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
