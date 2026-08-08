import { Timestamp } from '@angular/fire/firestore';

// ============================================================
// Task comment — a message on a task. `parentId` forms a one-level
// post → replies thread (null = a top-level post). `images` holds object
// paths (in the private "attachments" bucket) of pictures posted with the
// comment; the UI renders each via a short-lived signed URL.
// ============================================================

export interface TaskComment {
  id:          string;
  taskId:      string;
  parentId:    string | null;
  authorId:    string;
  authorName:  string;
  authorPhoto: string | null;
  body:        string;
  images:      string[];   // storage object paths (attachments bucket)
  createdAt:   Timestamp;
  updatedAt:   Timestamp;
}

/** A comment with its nested replies — for recursive rendering (any depth). */
export interface CommentNode {
  comment:  TaskComment;
  children: CommentNode[];
}

/** Build a reply tree from the flat comment list. `parentId` may point at any
 *  comment, so replies can themselves be replied to (unlimited depth). Siblings
 *  are ordered oldest-first at every level. */
export function buildCommentTree(all: TaskComment[]): CommentNode[] {
  const byTime = (a: CommentNode, b: CommentNode) =>
    (a.comment.createdAt?.seconds ?? 0) - (b.comment.createdAt?.seconds ?? 0);
  const nodes = new Map<string, CommentNode>();
  for (const c of all) nodes.set(c.id, { comment: c, children: [] });
  const roots: CommentNode[] = [];
  for (const c of all) {
    const node = nodes.get(c.id)!;
    const parent = c.parentId ? nodes.get(c.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortRec = (list: CommentNode[]) => { list.sort(byTime); list.forEach(n => sortRec(n.children)); };
  sortRec(roots);
  return roots;
}
