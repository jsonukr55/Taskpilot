import { Injectable, inject, signal } from '@angular/core';
import {
  Firestore, collection, query, where, orderBy, onSnapshot,
  doc, addDoc, updateDoc, deleteDoc, serverTimestamp,
  CollectionReference, DocumentReference
} from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { Note, NoteComment, NoteBlock, starterBlocks } from '@shared/models/note.model';

// ============================================================
// NoteService — collaborative group notes AND personal notes.
// A null groupId targets the top-level `notes` collection (personal).
// ============================================================

const SAVE_DEBOUNCE_MS = 350;

@Injectable({ providedIn: 'root' })
export class NoteService {
  private readonly firestore = inject(Firestore);
  private readonly auth      = inject(AuthService);

  // Notes list (either a group's notes or the user's personal notes)
  readonly notes        = signal<Note[]>([]);
  readonly notesLoading = signal(true);
  private notesUnsub?: () => void;

  // Active note (editor) + its comments
  readonly activeNote = signal<Note | null>(null);
  readonly comments   = signal<NoteComment[]>([]);
  private noteUnsub?: () => void;
  private commentsUnsub?: () => void;

  // ---- Path helpers (groupId null = personal top-level `notes`) ----
  private notesCol(groupId: string | null): CollectionReference {
    return groupId
      ? collection(this.firestore, 'groups', groupId, 'notes')
      : collection(this.firestore, 'notes');
  }
  private noteDoc(groupId: string | null, noteId: string): DocumentReference {
    return groupId
      ? doc(this.firestore, 'groups', groupId, 'notes', noteId)
      : doc(this.firestore, 'notes', noteId);
  }
  private commentsColOf(groupId: string | null, noteId: string): CollectionReference {
    return groupId
      ? collection(this.firestore, 'groups', groupId, 'notes', noteId, 'comments')
      : collection(this.firestore, 'notes', noteId, 'comments');
  }
  private commentDoc(groupId: string | null, noteId: string, commentId: string): DocumentReference {
    return groupId
      ? doc(this.firestore, 'groups', groupId, 'notes', noteId, 'comments', commentId)
      : doc(this.firestore, 'notes', noteId, 'comments', commentId);
  }

  // ---- Notes list ----

  /** Live list of a group's notes (ordered by recency). */
  openGroupNotes(groupId: string): void {
    this.closeGroupNotes();
    this.notesLoading.set(true);
    const q = query(this.notesCol(groupId), orderBy('updatedAt', 'desc'));
    this.notesUnsub = onSnapshot(q, snap => {
      this.notes.set(snap.docs.map(d => ({ id: d.id, ...d.data() } as Note)));
      this.notesLoading.set(false);
    }, () => this.notesLoading.set(false));
  }

  /** Live list of the signed-in user's personal notes (sorted client-side to avoid a composite index). */
  openPersonalNotes(): void {
    this.closeGroupNotes();
    const uid = this.auth.userId();
    if (!uid) return;
    this.notesLoading.set(true);
    const q = query(collection(this.firestore, 'notes'), where('ownerId', '==', uid));
    this.notesUnsub = onSnapshot(q, snap => {
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() } as Note));
      rows.sort((a, b) => (b.updatedAt?.seconds ?? 0) - (a.updatedAt?.seconds ?? 0));
      this.notes.set(rows);
      this.notesLoading.set(false);
    }, () => this.notesLoading.set(false));
  }

  closeGroupNotes(): void {
    this.notesUnsub?.();
    this.notesUnsub = undefined;
    this.notes.set([]);
  }

  // ---- Single note (editor) ----

  openNote(groupId: string | null, noteId: string): void {
    this.closeNote();
    this.noteUnsub = onSnapshot(this.noteDoc(groupId, noteId), snap => {
      this.activeNote.set(snap.exists() ? ({ id: snap.id, ...snap.data() } as Note) : null);
    });
    const cq = query(this.commentsColOf(groupId, noteId), orderBy('createdAt', 'asc'));
    this.commentsUnsub = onSnapshot(cq, snap => {
      this.comments.set(snap.docs.map(d => ({ id: d.id, ...d.data() } as NoteComment)));
    });
  }

  closeNote(): void {
    this.noteUnsub?.();
    this.commentsUnsub?.();
    this.noteUnsub = this.commentsUnsub = undefined;
    this.activeNote.set(null);
    this.comments.set([]);
  }

  // ---- Note CRUD ----

  async createNote(groupId: string | null, title = 'Untitled'): Promise<string> {
    const uid = this.auth.userId();
    if (!uid) throw new Error('Not authenticated');
    const ref = await addDoc(this.notesCol(groupId), {
      groupId:   groupId ?? null,
      ...(groupId ? {} : { ownerId: uid }),
      title,
      icon:      '📄',
      blocks:    starterBlocks(),
      createdBy: uid,
      updatedBy: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return ref.id;
  }

  async deleteNote(groupId: string | null, noteId: string): Promise<void> {
    await deleteDoc(this.noteDoc(groupId, noteId));
  }

  private async writeNote(groupId: string | null, noteId: string, changes: Partial<Note>): Promise<void> {
    const uid = this.auth.userId();
    // Firestore rejects `undefined`; non-todo blocks legitimately omit `checked`.
    await updateDoc(this.noteDoc(groupId, noteId), {
      ...stripUndefined(changes),
      updatedBy: uid ?? 'unknown',
      updatedAt: serverTimestamp()
    });
  }

  /** Immediate write (title, block-type, assignment). */
  updateNote(groupId: string | null, noteId: string, changes: Partial<Note>): Promise<void> {
    return this.writeNote(groupId, noteId, changes);
  }

  // ---- Debounced block saves ----

  private pending = new Map<string, { groupId: string | null; noteId: string; changes: Partial<Note> }>();
  private timers  = new Map<string, ReturnType<typeof setTimeout>>();

  queueSave(groupId: string | null, noteId: string, changes: Partial<Note>): void {
    const prev = this.pending.get(noteId)?.changes ?? {};
    this.pending.set(noteId, { groupId, noteId, changes: { ...prev, ...changes } });
    clearTimeout(this.timers.get(noteId));
    this.timers.set(noteId, setTimeout(() => { void this.flush(noteId); }, SAVE_DEBOUNCE_MS));
  }

  async flush(noteId: string): Promise<void> {
    const p = this.pending.get(noteId);
    if (!p) return;
    this.pending.delete(noteId);
    clearTimeout(this.timers.get(noteId));
    this.timers.delete(noteId);
    try {
      await this.writeNote(p.groupId, p.noteId, p.changes);
    } catch (e) {
      console.error('[NoteService] save failed', e);
    }
  }

  async flushAll(): Promise<void> {
    for (const noteId of [...this.pending.keys()]) await this.flush(noteId);
  }

  // ---- Comments (anchored to a block) ----

  async addComment(groupId: string | null, noteId: string, blockId: string, body: string): Promise<void> {
    const uid = this.auth.userId();
    if (!uid) throw new Error('Not authenticated');
    await addDoc(this.commentsColOf(groupId, noteId), {
      blockId,
      authorId:    uid,
      authorName:  this.auth.displayName() || 'You',
      authorPhoto: this.auth.photoURL() ?? null,
      body:        body.trim(),
      resolved:    false,
      createdAt:   serverTimestamp(),
      updatedAt:   serverTimestamp()
    });
  }

  async resolveComment(groupId: string | null, noteId: string, commentId: string, resolved: boolean): Promise<void> {
    await updateDoc(this.commentDoc(groupId, noteId, commentId), { resolved, updatedAt: serverTimestamp() });
  }

  async deleteComment(groupId: string | null, noteId: string, commentId: string): Promise<void> {
    await deleteDoc(this.commentDoc(groupId, noteId, commentId));
  }
}

/** Recursively drop keys whose value is `undefined` (Firestore rejects them). */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(v => stripUndefined(v)) as unknown as T;
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}
