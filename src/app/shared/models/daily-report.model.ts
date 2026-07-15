import { Timestamp } from '@angular/fire/firestore';
import { nanoid } from '@shared/utils/id.util';
import { NoteBlock, newBlock } from '@shared/models/note.model';

// ============================================================
// Daily Task Report ("Standup") — a thin reporting layer over
// Groups (team + manager) and Tasks (hybrid pre-fill source).
//
// Firestore layout:
//   dailyReports/{groupId}_{YYYY-MM-DD}          — parent (metadata + lock)
//   dailyReports/{groupId}_{date}/entries/{uid}  — one per member
// Entries are a subcollection so "a member edits only their own" (Decision #7)
// falls straight out of the security rules: write iff uid == auth.uid || manager.
// ============================================================

export type ReportStatus = 'draft' | 'locked';

/** A single bullet under Progress or Plan. `taskId` links to the source task
 *  (hybrid pre-fill); null for a hand-typed line. Text is a snapshot, so a line
 *  survives its source task being deleted. */
export interface ReportLine {
  id:      string;
  text:    string;
  taskId?: string | null;
}

export interface DailyEntry {
  userId:       string;
  displayName:  string;          // snapshot, so the report reads without extra lookups
  photoURL?:    string | null;
  progress:     ReportLine[];    // what they did today
  plan:         ReportLine[];    // what they'll do next working day
  onLeave:      boolean;         // renders "On leave" instead of bullets
  submitted:    boolean;         // member marked it ready
  updatedAt:    Timestamp;
}

export interface DailyReport {
  id:           string;          // `${groupId}_${date}`
  groupId:      string;
  date:         string;          // 'YYYY-MM-DD' working day (IST)
  planForDate:  string;          // 'YYYY-MM-DD' next working day
  status:       ReportStatus;
  lockedBy?:    string | null;
  lockedAt?:    Timestamp | null;
  memberOrder:  string[];        // uid order for the report
  noteId?:      string | null;   // group note this report is mirrored into (Send to group note)
  createdAt:    Timestamp;
  updatedAt:    Timestamp;
}

// ---- Working calendar --------------------------------------

export interface Holiday {
  date: string;   // 'YYYY-MM-DD'
  name: string;
}

export interface WorkingCalendar {
  weekends:  number[];   // day-of-week off, 0=Sun … 6=Sat
  holidays:  Holiday[];  // MANDATORY (company-wide) holidays only
  timezone:  string;     // IANA, e.g. 'Asia/Kolkata'
  updatedAt?: Timestamp;
}

// ---- Helpers -----------------------------------------------

export function newLine(text = '', taskId: string | null = null): ReportLine {
  return { id: nanoid(8), text, taskId };
}

/** A member's status for the manager's roster view. */
export type EntryStatus = 'submitted' | 'onLeave' | 'pending';

export function entryStatus(entry: DailyEntry | undefined): EntryStatus {
  if (!entry) return 'pending';
  if (entry.onLeave) return 'onLeave';
  return entry.submitted ? 'submitted' : 'pending';
}

export const ENTRY_STATUS_LABELS: Record<EntryStatus, string> = {
  submitted: 'Submitted',
  onLeave:   'On leave',
  pending:   'Pending'
};

// ---- Structured report (single source of truth for text + UI) ----

/** One person's block within a section. `onLeave` rows carry no lines. */
export interface ReportRow {
  userId:      string;
  displayName: string;
  onLeave:     boolean;
  lines:       string[];
}

export interface ReportView {
  dateHeader: string;
  progress:   ReportRow[];
  plan:       ReportRow[];
}

/**
 * Reduce the raw entries to the exact rows that appear in the report.
 * Ordering: `order` first (roster), then any stragglers.
 * Omission: members with no lines are dropped so the post stays clean.
 * On leave: a row under Progress ("On leave"); skipped under Plan.
 * This is the ONE place those rules live — both the text and the pretty
 * preview render from it, so they can never drift apart.
 */
export function buildReportView(opts: {
  dateHeader: string;          // e.g. '13 July 2026 (Monday)'
  entries:    DailyEntry[];
  order:      string[];        // uid order
}): ReportView {
  const byId = new Map(opts.entries.map(e => [e.userId, e]));
  const ordered: DailyEntry[] = [
    ...opts.order.map(uid => byId.get(uid)).filter((e): e is DailyEntry => !!e),
    ...opts.entries.filter(e => !opts.order.includes(e.userId))
  ];

  const rows = (pick: (e: DailyEntry) => ReportLine[], showLeave: boolean): ReportRow[] => {
    const out: ReportRow[] = [];
    for (const e of ordered) {
      if (e.onLeave) {
        if (showLeave) out.push({ userId: e.userId, displayName: e.displayName, onLeave: true, lines: [] });
        continue;
      }
      const lines = pick(e).map(l => l.text.trim()).filter(Boolean);
      if (!lines.length) continue;
      out.push({ userId: e.userId, displayName: e.displayName, onLeave: false, lines });
    }
    return out;
  };

  return {
    dateHeader: opts.dateHeader,
    progress:   rows(e => e.progress, true),
    plan:       rows(e => e.plan, false)
  };
}

/** Render a ReportView to the exact Teams-paste plain text. */
export function reportViewToText(view: ReportView): string {
  const section = (rows: ReportRow[]): string =>
    rows.map(r => r.onLeave
      ? `${r.displayName}\n  On leave`
      : [r.displayName, ...r.lines.map(t => `  ${t}`)].join('\n')
    ).join('\n');

  return [
    'Hi Everyone,',
    'Daily Task Report',
    `Date: ${view.dateHeader}`,
    'Progress Update',
    section(view.progress),
    'Plan for Tomorrow',
    section(view.plan)
  ].join('\n');
}

/** The exact Teams-paste text, straight from entries. */
export function buildReportText(opts: {
  dateHeader: string;
  entries:    DailyEntry[];
  order:      string[];
}): string {
  return reportViewToText(buildReportView(opts));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Rich-HTML version of the report — this is what goes on the clipboard as
 * `text/html` so pasting into Teams renders **bold** headers/names and bulleted
 * lists (matching the manager's target format), not flat text.
 */
export function reportViewToHtml(view: ReportView): string {
  const rowHtml = (r: ReportRow): string => {
    const name = `<p><strong>${escapeHtml(r.displayName)}</strong></p>`;
    if (r.onLeave) return `${name}<p>On leave</p>`;
    const items = r.lines.map(l => `<li>${escapeHtml(l)}</li>`).join('');
    return `${name}<ul>${items}</ul>`;
  };
  const section = (title: string, rows: ReportRow[]): string =>
    `<p><strong>${title}</strong></p>${rows.map(rowHtml).join('')}`;

  return [
    `<p>Hi Everyone,<br><strong>Daily Task Report</strong><br>`,
    `<strong>Date:</strong> ${escapeHtml(view.dateHeader)}</p>`,
    `<hr>`,
    section('Progress Update', view.progress),
    `<hr>`,
    section('Plan for Tomorrow', view.plan)
  ].join('');
}

/**
 * Render a ReportView as editable Note blocks (headings + bullets), following
 * the same Daily Report template. Shared by "Send to Notes" (personal) and
 * "Send to group note" so both stay in lockstep with the report format.
 */
export function reportViewToNoteBlocks(view: ReportView): NoteBlock[] {
  const esc = (s: string) => escapeHtml(s);
  const blocks: NoteBlock[] = [
    newBlock('paragraph', 'Hi Everyone,'),
    newBlock('paragraph', `Date: ${esc(view.dateHeader)}`),
    newBlock('h2', 'Progress Update')
  ];
  for (const r of view.progress) {
    blocks.push(newBlock('h3', esc(r.displayName)));
    if (r.onLeave) blocks.push(newBlock('paragraph', 'On leave'));
    else r.lines.forEach(l => blocks.push(newBlock('bulleted', esc(l))));
  }
  blocks.push(newBlock('h2', 'Plan for Tomorrow'));
  for (const r of view.plan) {
    blocks.push(newBlock('h3', esc(r.displayName)));
    r.lines.forEach(l => blocks.push(newBlock('bulleted', esc(l))));
  }
  return blocks;
}
