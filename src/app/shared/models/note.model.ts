import { Timestamp } from '@angular/fire/firestore';
import { nanoid } from '@shared/utils/id.util';

// ============================================================
// Note Model — collaborative rich-text doc, block-addressable
// so comments & assignment can anchor to a specific line.
// ============================================================

export type NoteBlockType =
  | 'paragraph'
  | 'h1' | 'h2' | 'h3'
  | 'bulleted' | 'numbered'
  | 'todo'
  | 'quote' | 'callout' | 'divider';

export type BlockAccessRole = 'viewer' | 'editor';

/** A member assigned to a line, with their access role for that line. */
export interface NoteBlockAssignee {
  userId: string;
  role:   BlockAccessRole;
}

export interface NoteBlock {
  id:          string;
  type:        NoteBlockType;
  html:        string;               // inline formatting (bold/italic/links) as sanitized HTML
  checked?:    boolean;              // only for 'todo'
  indent?:     number;               // nesting level for lists (0 = top level)
  assignees?:  NoteBlockAssignee[];  // per-line assignment + access (viewer/editor)
  assigneeId?: string | null;        // legacy single-assignee (read-only migration path)
  date?:       string | null;        // per-line date, ISO 'YYYY-MM-DD'
}

/** Normalized assignee list, folding in any legacy single `assigneeId`. */
export function blockAssignees(b: NoteBlock): NoteBlockAssignee[] {
  if (b.assignees?.length) return b.assignees;
  if (b.assigneeId) return [{ userId: b.assigneeId, role: 'editor' }];
  return [];
}

export interface Note {
  id:        string;
  groupId:   string | null;   // group note → groupId; personal note → null
  ownerId?:  string;          // set on personal notes (the creator)

  title:     string;
  icon?:     string;
  blocks:    NoteBlock[];

  createdBy: string;
  updatedBy: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface NoteComment {
  id:          string;
  blockId:     string;               // anchors the thread to a specific block/line
  authorId:    string;
  authorName:  string;
  authorPhoto: string | null;
  body:        string;
  resolved:    boolean;
  createdAt:   Timestamp;
  updatedAt:   Timestamp;
}

/** Summary shown in note lists (avoids loading full block content). */
export interface NoteSummary {
  id:        string;
  title:     string;
  icon?:     string;
  updatedAt: Timestamp;
  updatedBy: string;
}

// ---- Helpers ----

export function newBlock(type: NoteBlockType = 'paragraph', html = ''): NoteBlock {
  return { id: nanoid(10), type, html, assigneeId: null, ...(type === 'todo' ? { checked: false } : {}) };
}

/** A fresh note starts with a single empty paragraph so the editor has a caret target. */
export function starterBlocks(): NoteBlock[] {
  return [newBlock('paragraph', '')];
}

export const BLOCK_TYPE_LABELS: Record<NoteBlockType, string> = {
  paragraph: 'Text',
  h1:        'Heading 1',
  h2:        'Heading 2',
  h3:        'Heading 3',
  bulleted:  'Bulleted list',
  numbered:  'Numbered list',
  todo:      'To-do list',
  quote:     'Quote',
  callout:   'Callout',
  divider:   'Divider'
};
