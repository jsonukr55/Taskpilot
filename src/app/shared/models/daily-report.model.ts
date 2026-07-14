import { Timestamp } from '@angular/fire/firestore';
import { nanoid } from '@shared/utils/id.util';

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

/**
 * Build the exact Teams-paste text. Pure — no Firestore, no dates beyond the
 * pre-formatted header — so it's trivially testable and always matches format.
 *
 * Ordering: `order` first (roster), then any stragglers not in it.
 * Omission: members with no lines are dropped so the post stays clean.
 * On leave: shown once under Progress as "On leave"; skipped under Plan.
 */
export function buildReportText(opts: {
  dateHeader: string;          // e.g. '13 July 2026 (Monday)'
  entries:    DailyEntry[];
  order:      string[];        // uid order
}): string {
  const byId = new Map(opts.entries.map(e => [e.userId, e]));
  const ordered: DailyEntry[] = [
    ...opts.order.map(uid => byId.get(uid)).filter((e): e is DailyEntry => !!e),
    ...opts.entries.filter(e => !opts.order.includes(e.userId))
  ];

  const section = (pick: (e: DailyEntry) => ReportLine[], showLeave: boolean): string => {
    const blocks: string[] = [];
    for (const e of ordered) {
      if (e.onLeave) {
        if (showLeave) blocks.push(`${e.displayName}\n  On leave`);
        continue;
      }
      const lines = pick(e).map(l => l.text.trim()).filter(Boolean);
      if (!lines.length) continue;
      blocks.push([e.displayName, ...lines.map(t => `  ${t}`)].join('\n'));
    }
    return blocks.join('\n');
  };

  return [
    'Hi Everyone,',
    'Daily Task Report',
    `Date: ${opts.dateHeader}`,
    'Progress Update',
    section(e => e.progress, true),
    'Plan for Tomorrow',
    section(e => e.plan, false)
  ].join('\n');
}
