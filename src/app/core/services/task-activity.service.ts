import { Injectable, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { TaskActivity } from '@shared/models/task-activity.model';
import { toTs } from './supabase-map.util';

// ============================================================
// TaskActivityService — the activity feed for the open task.
// Initial fetch + realtime channel (filtered by task) → same signal.
// ============================================================

@Injectable({ providedIn: 'root' })
export class TaskActivityService {
  private readonly supa = inject(SupabaseService);

  readonly activity = signal<TaskActivity[]>([]);
  private taskId?: string;
  private channel?: RealtimeChannel;

  open(taskId: string): void {
    if (this.taskId === taskId) return;
    this.close();
    this.taskId = taskId;
    void this.load(taskId);
    try {
      this.channel = this.supa.client
        .channel(`task_activity:${taskId}`)
        .on('postgres_changes',
          { event: '*', schema: 'public', table: 'task_activity', filter: `task_id=eq.${taskId}` },
          () => void this.load(taskId))
        .subscribe();
    } catch (e) { console.error('[activity realtime]', e); }
  }

  close(): void {
    if (this.channel) { void this.supa.client.removeChannel(this.channel); this.channel = undefined; }
    this.taskId = undefined;
    this.activity.set([]);
  }

  private async load(taskId: string): Promise<void> {
    try {
      const { data, error } = await this.supa.db('task_activity')
        .select('*').eq('task_id', taskId).order('created_at', { ascending: false });
      if (this.taskId !== taskId) return;
      if (error) { console.error('[activity load]', error); return; }
      this.activity.set((data ?? []).map(rowToActivity));
    } catch (e) {
      console.error('[activity load threw]', e);
    }
  }
}

function rowToActivity(r: any): TaskActivity {
  return {
    id:        r.id,
    taskId:    r.task_id,
    actorId:   r.actor_id ?? null,
    actorName: r.actor_name ?? null,
    action:    r.action,
    field:     r.field ?? null,
    detail:    r.detail,
    createdAt: toTs(r.created_at) as any,
  };
}
