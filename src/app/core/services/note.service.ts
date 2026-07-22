import { Injectable, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { NoteAccessService } from './note-access.service';
import { Note, NoteComment, starterBlocks } from '@shared/models/note.model';
import { toTs } from './supabase-map.util';

// ============================================================
// NoteService — collaborative group notes AND personal notes (Supabase).
// One flat `notes` table: group_id set → group note; owner_id set → personal.
// Comments live in note_comments (note_id FK). Same public API as before.
// ============================================================

const SAVE_DEBOUNCE_MS = 350;

@Injectable({ providedIn: 'root' })
export class NoteService {
  private readonly supa       = inject(SupabaseService);
  private readonly auth       = inject(AuthService);
  private readonly noteAccess = inject(NoteAccessService);

  // Notes list (either a group's notes or the user's personal notes)
  readonly notes        = signal<Note[]>([]);
  readonly notesLoading = signal(true);
  private notesChannel?: RealtimeChannel;

  // Active note (editor) + its comments
  readonly activeNote = signal<Note | null>(null);
  /** True when the opened note no longer exists / can't be read (deleted elsewhere). */
  readonly activeNoteMissing = signal(false);
  readonly comments   = signal<NoteComment[]>([]);
  private noteChannel?: RealtimeChannel;

  // ---- Notes list ----

  /** Live list of a group's notes (ordered by recency). */
  openGroupNotes(groupId: string): void {
    this.closeGroupNotes();
    this.notesLoading.set(true);
    void this.loadNotes({ column: 'group_id', value: groupId });
    this.notesChannel = this.supa.client
      .channel(`notes-list:${groupId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes', filter: `group_id=eq.${groupId}` },
        () => void this.loadNotes({ column: 'group_id', value: groupId }))
      .subscribe();
  }

  /** Live list of the signed-in user's personal notes. */
  openPersonalNotes(): void {
    this.closeGroupNotes();
    const uid = this.auth.userId();
    if (!uid) return;
    this.notesLoading.set(true);
    void this.loadNotes({ column: 'owner_id', value: uid });
    this.notesChannel = this.supa.client
      .channel(`notes-list:personal:${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes', filter: `owner_id=eq.${uid}` },
        () => void this.loadNotes({ column: 'owner_id', value: uid }))
      .subscribe();
  }

  private async loadNotes(where: { column: string; value: string }): Promise<void> {
    const { data } = await this.supa.db('notes')
      .select('*').eq(where.column, where.value).order('updated_at', { ascending: false });
    this.notes.set((data ?? []).map(rowToNote));
    this.notesLoading.set(false);
  }

  closeGroupNotes(): void {
    if (this.notesChannel) { void this.supa.client.removeChannel(this.notesChannel); this.notesChannel = undefined; }
    this.notes.set([]);
  }

  // ---- Single note (editor) ----

  openNote(_groupId: string | null, noteId: string): void {
    this.closeNote();
    void this.loadNote(noteId);
    this.noteChannel = this.supa.client
      .channel(`note:${noteId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes', filter: `id=eq.${noteId}` },
        () => void this.loadNote(noteId))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'note_comments', filter: `note_id=eq.${noteId}` },
        () => void this.loadComments(noteId))
      .subscribe();
  }

  private async loadNote(noteId: string): Promise<void> {
    const { data, error } = await this.supa.db('notes').select('*').eq('id', noteId).maybeSingle();
    if (error || !data) {
      // Gone or unreadable (deleted elsewhere / access revoked) — self-heal.
      this.noteAccess.forget(noteId);
      this.activeNoteMissing.set(true);
      this.activeNote.set(null);
      return;
    }
    this.activeNoteMissing.set(false);
    this.activeNote.set(rowToNote(data));
    void this.loadComments(noteId);
  }

  private async loadComments(noteId: string): Promise<void> {
    const { data } = await this.supa.db('note_comments')
      .select('*').eq('note_id', noteId).order('created_at', { ascending: true });
    this.comments.set((data ?? []).map(rowToComment));
  }

  closeNote(): void {
    if (this.noteChannel) { void this.supa.client.removeChannel(this.noteChannel); this.noteChannel = undefined; }
    this.activeNote.set(null);
    this.activeNoteMissing.set(false);
    this.comments.set([]);
  }

  // ---- Note CRUD ----

  async createNote(groupId: string | null, title = 'Untitled'): Promise<string> {
    const uid = this.auth.userId();
    if (!uid) throw new Error('Not authenticated');
    const { data, error } = await this.supa.db('notes').insert({
      group_id:   groupId ?? null,
      owner_id:   groupId ? null : uid,
      title,
      icon:       '📄',
      blocks:     starterBlocks(),
      created_by: uid,
      updated_by: uid,
    }).select('id').single();
    if (error) throw error;
    return data.id;
  }

  async deleteNote(_groupId: string | null, noteId: string): Promise<void> {
    await this.supa.db('notes').delete().eq('id', noteId);
    // Drop the note from the user's favorites/pins/recents (central hook).
    this.noteAccess.forget(noteId);
  }

  private async writeNote(_groupId: string | null, noteId: string, changes: Partial<Note>): Promise<void> {
    const uid = this.auth.userId();
    await this.supa.db('notes').update({ ...notePatch(changes), updated_by: uid ?? 'unknown' }).eq('id', noteId);
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

  async addComment(_groupId: string | null, noteId: string, blockId: string, body: string): Promise<void> {
    const uid = this.auth.userId();
    if (!uid) throw new Error('Not authenticated');
    await this.supa.db('note_comments').insert({
      note_id:      noteId,
      block_id:     blockId,
      author_id:    uid,
      author_name:  this.auth.displayName() || 'You',
      author_photo: this.auth.photoURL() ?? null,
      body:         body.trim(),
      resolved:     false,
    });
  }

  async resolveComment(_groupId: string | null, _noteId: string, commentId: string, resolved: boolean): Promise<void> {
    await this.supa.db('note_comments').update({ resolved }).eq('id', commentId);
  }

  async deleteComment(_groupId: string | null, _noteId: string, commentId: string): Promise<void> {
    await this.supa.db('note_comments').delete().eq('id', commentId);
  }
}

// ---- Mapping ----

function rowToNote(r: any): Note {
  return {
    id:        r.id,
    groupId:   r.group_id ?? null,
    ownerId:   r.owner_id ?? undefined,
    title:     r.title,
    icon:      r.icon ?? undefined,
    blocks:    r.blocks ?? [],
    createdBy: r.created_by,
    updatedBy: r.updated_by,
    createdAt: toTs(r.created_at) as any,
    updatedAt: toTs(r.updated_at) as any,
  };
}

function rowToComment(r: any): NoteComment {
  return {
    id:          r.id,
    blockId:     r.block_id,
    authorId:    r.author_id,
    authorName:  r.author_name,
    authorPhoto: r.author_photo ?? null,
    body:        r.body,
    resolved:    r.resolved,
    createdAt:   toTs(r.created_at) as any,
    updatedAt:   toTs(r.updated_at) as any,
  };
}

function notePatch(c: Partial<Note>): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (c.title  !== undefined) p['title']  = c.title;
  if (c.icon   !== undefined) p['icon']   = c.icon;
  if (c.blocks !== undefined) p['blocks'] = c.blocks;
  return p;
}
