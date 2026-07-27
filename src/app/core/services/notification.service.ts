import { Injectable, inject, signal, computed } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { AppNotification } from '@shared/models/notification.model';
import { toTs } from './supabase-map.util';

// ============================================================
// NotificationService — the signed-in user's in-app notification feed.
// Initial fetch + a realtime channel (scoped to my rows) that refetches
// into the same signal. Mirrors the app's other realtime services.
// ============================================================

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly supa = inject(SupabaseService);
  private readonly auth = inject(AuthService);

  readonly notifications = signal<AppNotification[]>([]);
  readonly unreadCount   = computed(() => this.notifications().filter(n => !n.read).length);

  private channel?: RealtimeChannel;

  startListening(): void {
    const uid = this.auth.userId();
    if (!uid) return;
    void this.load();
    this.channel = this.supa.client
      .channel(`notifications:${uid}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` },
        () => void this.load())
      .subscribe();
  }

  stopListening(): void {
    if (this.channel) { void this.supa.client.removeChannel(this.channel); this.channel = undefined; }
    this.notifications.set([]);
  }

  private async load(): Promise<void> {
    const { data } = await this.supa.db('notifications')
      .select('*').order('created_at', { ascending: false }).limit(50);
    this.notifications.set((data ?? []).map(rowToNotification));
  }

  async markRead(id: string): Promise<void> {
    // Optimistic; realtime refetch reconciles.
    this.notifications.update(list => list.map(n => n.id === id ? { ...n, read: true } : n));
    await this.supa.db('notifications').update({ read: true }).eq('id', id);
  }

  async markAllRead(): Promise<void> {
    const uid = this.auth.userId();
    if (!uid) return;
    this.notifications.update(list => list.map(n => ({ ...n, read: true })));
    await this.supa.db('notifications').update({ read: true }).eq('user_id', uid).eq('read', false);
  }

  async remove(id: string): Promise<void> {
    this.notifications.update(list => list.filter(n => n.id !== id));
    await this.supa.db('notifications').delete().eq('id', id);
  }
}

// ---- Mapping ----

function rowToNotification(r: any): AppNotification {
  return {
    id:        r.id,
    userId:    r.user_id,
    actorId:   r.actor_id ?? null,
    type:      r.type,
    taskId:    r.task_id ?? null,
    title:     r.title,
    body:      r.body,
    read:      r.read,
    createdAt: toTs(r.created_at) as any,
  };
}
