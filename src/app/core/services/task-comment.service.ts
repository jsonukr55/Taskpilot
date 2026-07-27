import { Injectable, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { TaskComment } from '@shared/models/task-comment.model';
import { toTs } from './supabase-map.util';

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

  readonly comments = signal<TaskComment[]>([]);
  private taskId?: string;
  private channel?: RealtimeChannel;

  /** Load + stream the comments for a task (replaces any previous thread). */
  open(taskId: string): void {
    if (this.taskId === taskId) return;
    this.close();
    this.taskId = taskId;
    void this.load(taskId);
    this.channel = this.supa.client
      .channel(`task_comments:${taskId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'task_comments', filter: `task_id=eq.${taskId}` },
        () => void this.load(taskId))
      .subscribe();
  }

  close(): void {
    if (this.channel) { void this.supa.client.removeChannel(this.channel); this.channel = undefined; }
    this.taskId = undefined;
    this.comments.set([]);
  }

  private async load(taskId: string): Promise<void> {
    const { data } = await this.supa.db('task_comments').select('*').eq('task_id', taskId);
    // Ignore a stale response if the open task changed mid-flight.
    if (this.taskId !== taskId) return;
    this.comments.set((data ?? []).map(rowToComment));
  }

  // ---- Mutations ----

  async add(taskId: string, body: string, parentId: string | null = null): Promise<void> {
    const uid = this.auth.userId();
    if (!uid) throw new Error('Not authenticated');
    const { error } = await this.supa.db('task_comments').insert({
      task_id:      taskId,
      parent_id:    parentId,
      author_id:    uid,
      author_name:  this.auth.displayName() || 'You',
      author_photo: this.auth.photoURL() ?? null,
      body:         body.trim(),
    });
    if (error) throw error;
  }

  async edit(id: string, body: string): Promise<void> {
    const { error } = await this.supa.db('task_comments').update({ body: body.trim() }).eq('id', id);
    if (error) throw error;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supa.db('task_comments').delete().eq('id', id);
    if (error) throw error;
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
    createdAt:   toTs(r.created_at) as any,
    updatedAt:   toTs(r.updated_at) as any,
  };
}
