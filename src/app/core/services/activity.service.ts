import { Injectable, inject, computed, Signal } from '@angular/core';
import { Timestamp } from '@angular/fire/firestore';
import { TaskService } from './task.service';
import { GroupService } from './group.service';
import { AuthService } from './auth.service';
import { Task } from '@shared/models/task.model';
import { Note } from '@shared/models/note.model';
import { Group, GroupInvite } from '@shared/models/group.model';
import { DailyEntry } from '@shared/models/daily-report.model';
import { ActivityEvent, ActivityKind, ActivityCategory } from '@shared/models/activity.model';

// ============================================================
// ActivityService
// ------------------------------------------------------------
// A single, reusable engine that DERIVES a unified activity stream
// from existing data (task/note/group/report timestamps). No new
// Firestore collection or listener — events are computed from the
// signals already streaming into the app.
//
// Two ways to use it:
//  • `feed` — a global computed stream from the always-live signals
//    (tasks + my groups). Consumed by the dashboard.
//  • pure builders (`fromTasks` / `fromNotes` / `fromGroups` /
//    `fromInvites` / `fromReportEntries`) — any page can build a
//    SCOPED feed from data it already holds (e.g. a group's tasks +
//    notes + invites), then `merge()` them. This is what makes the
//    activity feed reusable throughout the app.
//
// Note: personal/group NOTES and daily REPORTS aren't globally loaded,
// so they don't appear in the global `feed`; use the builders on the
// pages that do load them.
// ============================================================

const UPDATE_THRESHOLD_MS = 60_000;   // ignore updatedAt ~= createdAt (creation noise)
const CHECKLIST_WINDOW_MS = 10_000;   // treat updatedAt within this of a check as "checklist"

interface Meta { label: string; icon: string; category: ActivityCategory; }

const META: Record<ActivityKind, Meta> = {
  task_created:      { label: 'Created task',     icon: 'plus',         category: 'task' },
  task_completed:    { label: 'Completed task',   icon: 'check',        category: 'task' },
  task_updated:      { label: 'Updated task',     icon: 'edit-2',       category: 'task' },
  checklist_updated: { label: 'Updated checklist', icon: 'check-square', category: 'task' },
  subtask_added:     { label: 'Added subtask',    icon: 'list',         category: 'task' },
  note_edited:       { label: 'Edited note',      icon: 'file-text',    category: 'note' },
  group_created:     { label: 'Created group',    icon: 'users',        category: 'group' },
  group_joined:      { label: 'Joined group',     icon: 'user-plus',    category: 'group' },
  member_invited:    { label: 'Invited member',   icon: 'user-plus',    category: 'group' },
  report_submitted:  { label: 'Submitted report', icon: 'send',         category: 'report' },
};

@Injectable({ providedIn: 'root' })
export class ActivityService {
  private readonly tasks  = inject(TaskService);
  private readonly groups = inject(GroupService);
  private readonly auth   = inject(AuthService);

  /** Global activity stream from the always-live signals (top 40, newest first). */
  readonly feed: Signal<ActivityEvent[]> = computed(() =>
    this.merge([
      ...this.fromTasks(this.tasks.tasks()),
      ...this.fromGroups(this.groups.groups()),
    ], 40)
  );

  // ---- Pure builders (reusable on any page with the data) -------------

  /** Task activity: creation (or subtask add), completion, and the most
   *  recent of {checklist update, generic update}. At most 2 events/task. */
  fromTasks(tasks: Task[]): ActivityEvent[] {
    const events: ActivityEvent[] = [];
    for (const t of tasks) {
      // Creation event.
      if (t.createdAt) {
        events.push(this.event(t.parentId ? 'subtask_added' : 'task_created', t.id, t.title, t.createdAt));
      }
      // A single "activity" event (completed > checklist > updated).
      if (t.status === 'completed' && t.completedAt) {
        events.push(this.event('task_completed', t.id, t.title, t.completedAt));
      } else {
        const lastChecked = this.latestChecklistCheck(t);
        const updatedMs   = t.updatedAt?.toMillis() ?? 0;
        if (lastChecked && Math.abs(lastChecked.toMillis() - updatedMs) <= CHECKLIST_WINDOW_MS) {
          events.push(this.event('checklist_updated', t.id, t.title, lastChecked));
        } else if (t.updatedAt && t.createdAt && updatedMs - t.createdAt.toMillis() > UPDATE_THRESHOLD_MS) {
          events.push(this.event('task_updated', t.id, t.title, t.updatedAt));
        }
      }
    }
    return events;
  }

  /** Note activity: one "edited" event per note (routes to the note). */
  fromNotes(notes: Note[]): ActivityEvent[] {
    return notes
      .filter(n => n.updatedAt)
      .map(n => this.event('note_edited', n.id, n.title || 'Untitled', n.updatedAt,
        n.groupId ? ['/groups', n.groupId, 'notes', n.id] : ['/notes', n.id]));
  }

  /** Group activity: created (owner) or joined (member), routes to the group.
   *  Join time isn't stored per-member, so joins approximate to the group's
   *  createdAt (stable — never reorders). */
  fromGroups(groups: Group[]): ActivityEvent[] {
    const uid = this.auth.userId();
    return groups
      .filter(g => g.createdAt)
      .map(g => this.event(
        g.ownerId === uid ? 'group_created' : 'group_joined',
        g.id, g.name, g.createdAt, ['/groups', g.id]));
  }

  /** Invite activity: one "invited member" event per active invite. */
  fromInvites(invites: GroupInvite[]): ActivityEvent[] {
    return invites
      .filter(i => !i.revoked && i.createdAt)
      .map(i => this.event('member_invited', i.id, i.groupName, i.createdAt, ['/groups', i.groupId]));
  }

  /** Report activity: one event per submitted daily-report entry. */
  fromReportEntries(entries: DailyEntry[], reportLabel = 'daily report'): ActivityEvent[] {
    return entries
      .filter(e => e.submitted && e.updatedAt)
      .map(e => this.event('report_submitted', e.userId, `${e.displayName} · ${reportLabel}`, e.updatedAt));
  }

  /** Flatten, dedupe by id, sort newest-first, and cap. */
  merge(events: ActivityEvent[], limit = 30): ActivityEvent[] {
    const byId = new Map<string, ActivityEvent>();
    for (const e of events) if (!byId.has(e.id)) byId.set(e.id, e);
    return [...byId.values()]
      .sort((a, b) => b.at.toMillis() - a.at.toMillis())
      .slice(0, limit);
  }

  // ---- Internals ------------------------------------------------------

  private event(kind: ActivityKind, entityId: string, title: string, at: Timestamp, route?: string[]): ActivityEvent {
    const m = META[kind];
    return { id: `${entityId}_${kind}`, category: m.category, kind, title, label: m.label, icon: m.icon, at, entityId, route };
  }

  /** Most recent completedAt among a task's checked checklist items. */
  private latestChecklistCheck(t: Task): Timestamp | null {
    let latest: Timestamp | null = null;
    for (const item of t.checklist ?? []) {
      if (item.completed && item.completedAt) {
        if (!latest || item.completedAt.toMillis() > latest.toMillis()) latest = item.completedAt;
      }
    }
    return latest;
  }
}
