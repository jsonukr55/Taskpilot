import { Injectable, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { StorageService } from './storage.service';
import {
  TaskAttachment, ALLOWED_EXTENSIONS, MAX_ATTACHMENT_BYTES, extensionOf,
} from '@shared/models/task-attachment.model';
import { toTs } from './supabase-map.util';

// ============================================================
// AttachmentService — files for the currently open task. Initial fetch
// + realtime channel (per task) into the same signal, mirroring the
// other services. Binary I/O is delegated to StorageService.
// ============================================================
@Injectable({ providedIn: 'root' })
export class AttachmentService {
  private readonly supa    = inject(SupabaseService);
  private readonly auth    = inject(AuthService);
  private readonly storage = inject(StorageService);

  readonly attachments = signal<TaskAttachment[]>([]);
  private taskId?: string;
  private channel?: RealtimeChannel;

  open(taskId: string): void {
    if (this.taskId === taskId) return;
    this.close();
    this.taskId = taskId;
    void this.load(taskId);
    this.channel = this.supa.client
      .channel(`task_attachments:${taskId}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'task_attachments', filter: `task_id=eq.${taskId}` },
        () => void this.load(taskId))
      .subscribe();
  }

  close(): void {
    if (this.channel) { void this.supa.client.removeChannel(this.channel); this.channel = undefined; }
    this.taskId = undefined;
    this.attachments.set([]);
  }

  private async load(taskId: string): Promise<void> {
    const { data } = await this.supa.db('task_attachments')
      .select('*').eq('task_id', taskId).order('created_at', { ascending: false });
    if (this.taskId !== taskId) return;
    this.attachments.set((data ?? []).map(rowToAttachment));
  }

  /** Validate, upload the binary, then record the metadata row. */
  async upload(taskId: string, file: File): Promise<void> {
    const ext = extensionOf(file.name);
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      throw new Error(`"${ext || 'this'}" files aren't allowed. Try an image, video, PDF, ZIP or document.`);
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error('That file is over the 25 MB limit.');
    }
    const uid = this.auth.userId();
    if (!uid) throw new Error('Not authenticated');

    const safe = file.name.replace(/[^\w.\-]+/g, '_');
    const path = `${taskId}/${crypto.randomUUID()}-${safe}`;
    await this.storage.upload(path, file);

    const { error } = await this.supa.db('task_attachments').insert({
      task_id:       taskId,
      name:          file.name,
      mime:          file.type || null,
      size:          file.size,
      path,
      uploader_id:   uid,
      uploader_name: this.auth.displayName() || 'You',
    });
    if (error) { await this.storage.remove([path]).catch(() => {}); throw error; }
  }

  async remove(att: TaskAttachment): Promise<void> {
    await this.supa.db('task_attachments').delete().eq('id', att.id);
    await this.storage.remove([att.path]).catch(() => {});   // best-effort; row already gone
  }

  signedUrl(att: TaskAttachment): Promise<string> {
    return this.storage.signedUrl(att.path);
  }
}

function rowToAttachment(r: any): TaskAttachment {
  return {
    id:           r.id,
    taskId:       r.task_id,
    name:         r.name,
    mime:         r.mime ?? null,
    size:         Number(r.size ?? 0),
    path:         r.path,
    uploaderId:   r.uploader_id ?? null,
    uploaderName: r.uploader_name ?? null,
    createdAt:    toTs(r.created_at) as any,
  };
}
