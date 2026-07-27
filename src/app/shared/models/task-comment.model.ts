import { Timestamp } from '@angular/fire/firestore';

// ============================================================
// Task comment — a message on a task. `parentId` forms a one-level
// post → replies thread (null = a top-level post). Image attachments
// arrive with the file-storage epic (Epic 6).
// ============================================================

export interface TaskComment {
  id:          string;
  taskId:      string;
  parentId:    string | null;
  authorId:    string;
  authorName:  string;
  authorPhoto: string | null;
  body:        string;
  createdAt:   Timestamp;
  updatedAt:   Timestamp;
}

/** A top-level comment with its (chronological) replies — for rendering. */
export interface CommentThread {
  post:    TaskComment;
  replies: TaskComment[];
}

/** Group a flat comment list into top-level posts + their replies. */
export function threadComments(all: TaskComment[]): CommentThread[] {
  const byTime = (a: TaskComment, b: TaskComment) =>
    (a.createdAt?.seconds ?? 0) - (b.createdAt?.seconds ?? 0);
  const posts   = all.filter(c => !c.parentId).sort(byTime);
  const replies = all.filter(c => c.parentId);
  return posts.map(post => ({
    post,
    replies: replies.filter(r => r.parentId === post.id).sort(byTime),
  }));
}
