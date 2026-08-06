import { Injectable, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { StorageService } from './storage.service';
import { TaskComment } from '@shared/models/task-comment.model';
import { toTs } from './supabase-map.util';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;   // 10 MB per comment image

// ============================================================
// TaskCommentService — threaded comments for the currently open task.
// One task's thread is loaded at a time (the task drawer opens it).
// Pattern mirrors NoteService.comments: initial fetch + a realtime
// channel that refetches into the same signal.
// ============================================================

@Injectable({ providedIn: 'root' })
export class TaskCommentService {
  private readonly supa = inject(SupabaseService);
  private readonly auth = inject(AuthService);
  private readonly storage = inject(StorageService);

  readonly comments = signal<TaskComment[]>([]);
  private taskId?: string;
  private channel?: RealtimeChannel;

  /** Load + stream the comments for a task (replaces any previous thread). */
  open(taskId: string): void {
    if (this.taskId === taskId) return;
    this.close();
    this.taskId = taskId;
    void this.load(taskId);
    try {
      this.channel = this.supa.client
        .channel(`task_comments:${taskId}`)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'task_comments', filter: `task_id=eq.${taskId}` },
          () => void this.load(taskId))
        .subscribe();
    } catch (e) { console.error('[comments realtime]', e); }
  }

  close(): void {
    if (this.channel) { void this.supa.client.removeChannel(this.channel); this.channel = undefined; }
    this.taskId = undefined;
    this.comments.set([]);
  }

  private async load(taskId: string): Promise<void> {
    try {
      const { data } = await this.supa.db('task_comments').select('*').eq('task_id', taskId);
      // Ignore a stale response if the open task changed mid-flight.
      if (this.taskId !== taskId) return;
      this.comments.set((data ?? []).map(rowToComment));
    } catch (e) { console.error('[comments load threw]', e); }
  }

  // ---- Mutations ----

  async add(taskId: string, body: string, parentId: string | null = null, images: string[] = []): Promise<void> {
    const uid = this.auth.userId();
    if (!uid) throw new Error('Not authenticated');
    const { error } = await this.supa.db('task_comments').insert({
      task_id:      taskId,
      parent_id:    parentId,
      author_id:    uid,
      author_name:  this.auth.displayName() || 'You',
      author_photo: this.auth.photoURL() ?? null,
      body:         body.trim(),
      image_paths:  images,
    });
    if (error) throw error;
  }

  async edit(id: string, body: string): Promise<void> {
    const { error } = await this.supa.db('task_comments').update({ body: body.trim() }).eq('id', id);
    if (error) throw error;
  }

  async remove(id: string, images: string[] = []): Promise<void> {
    const { error } = await this.supa.db('task_comments').delete().eq('id', id);
    if (error) throw error;
    if (images.length) await this.storage.remove(images).catch(() => {});   // best-effort
  }

  // ---- Comment images (private "attachments" bucket) ----

  /** Validate + upload one image; returns its object path (store on the comment). */
  async uploadImage(taskId: string, file: File): Promise<string> {
    if (!file.type.startsWith('image/')) throw new Error('Only image files can be added to a comment.');
    if (file.size > MAX_IMAGE_BYTES)     throw new Error('That image is over the 10 MB limit.');
    const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase() : 'png';
    const path = `${taskId}/comments/${crypto.randomUUID()}.${ext}`;
    await this.storage.upload(path, file);
    return path;
  }

  /** Short-lived signed URL to render a stored comment image. */
  signedUrl(path: string): Promise<string> {
    return this.storage.signedUrl(path);
  }
}

// ---- Mapping ----

function rowToComment(r: any): TaskComment {
  return {
    id:          r.id,
    taskId:      r.task_id,
    parentId:    r.parent_id ?? null,
    authorId:    r.author_id,
    authorName:  r.author_name,
    authorPhoto: r.author_photo ?? null,
    body:        r.body,
    images:      r.image_paths ?? [],
    createdAt:   toTs(r.created_at) as any,
    updatedAt:   toTs(r.updated_at) as any,
  };
}
