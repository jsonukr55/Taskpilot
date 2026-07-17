import { Timestamp } from '@angular/fire/firestore';

// ============================================================
// Activity Models — a unified, cross-entity activity stream.
// ------------------------------------------------------------
// Events are DERIVED from existing data (task/note/group/report
// timestamps) rather than written to a new collection — there is no
// schema/collection change. ActivityService turns the live service
// signals into these events; <tp-activity-feed> renders them.
// ============================================================

export type ActivityCategory = 'task' | 'note' | 'group' | 'report';

export type ActivityKind =
  | 'task_created'
  | 'task_completed'
  | 'task_updated'
  | 'checklist_updated'
  | 'subtask_added'
  | 'note_edited'
  | 'group_created'
  | 'group_joined'
  | 'member_invited'
  | 'report_submitted';

export interface ActivityEvent {
  /** Stable id: `${entityId}_${kind}` (dedupes across recomputes). */
  id:        string;
  category:  ActivityCategory;
  kind:      ActivityKind;
  /** Primary display text — the entity's title/name. */
  title:     string;
  /** Short verb label, e.g. "Completed task". */
  label:     string;
  /** tp-icon name for the event bubble. */
  icon:      string;
  /** When the event happened. */
  at:        Timestamp;
  /** The underlying entity id (task/note/group id) the consumer can act on. */
  entityId:  string;
  /** Optional in-app route to open the entity (notes/groups navigate). */
  route?:    string[];
}
