import { Injectable, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import { Client } from '@shared/models/client.model';
import { slugId } from '@shared/utils/id.util';
import { toTs } from './supabase-map.util';

// ============================================================
// ClientService — top-level tenants (customers). Created and managed
// ONLY by the global super-admin (enforced by RLS); org members can
// read the client their organization belongs to. Mirrors the
// signal + realtime-refetch lifecycle of the other services.
// ============================================================

@Injectable({ providedIn: 'root' })
export class ClientService {
  private readonly supa = inject(SupabaseService);
  private readonly auth = inject(AuthService);

  readonly clients   = signal<Client[]>([]);
  readonly isLoading = signal(true);
  readonly error     = signal<string | null>(null);

  private channel?: RealtimeChannel;

  // ---- Lifecycle ----

  startListening(): void {
    const uid = this.auth.userId();
    if (!uid) return;
    this.isLoading.set(true);

    void this.load();
    // Reload on client changes, and on org-membership changes (which can
    // change which clients a non-admin member can see).
    this.channel = this.supa.client
      .channel(`clients:${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clients' },       () => void this.load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'org_members' },   () => void this.load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'organizations' }, () => void this.load())
      .subscribe();
  }

  stopListening(): void {
    if (this.channel) { void this.supa.client.removeChannel(this.channel); this.channel = undefined; }
  }

  private async load(): Promise<void> {
    const { data, error } = await this.supa.db('clients').select('*').order('name');
    if (error) { this.error.set(error.message); this.isLoading.set(false); return; }
    this.clients.set((data ?? []).map(rowToClient));
    this.isLoading.set(false);
  }

  // ---- Queries ----

  getClientById(id: string): Client | undefined {
    return this.clients().find(c => c.id === id);
  }

  // ---- CRUD (super-admin only, enforced by RLS) ----

  async createClient(data: { name: string; description?: string; icon: string; color: string }): Promise<string> {
    const uid = this.auth.userId();
    if (!uid) throw new Error('Not authenticated');

    const id = slugId(data.name);
    const { error } = await this.supa.db('clients').insert({
      id,
      name:        data.name.trim(),
      description: data.description?.trim() ?? '',
      icon:        data.icon,
      color:       data.color,
      created_by:  uid,
    });
    if (error) throw error;
    return id;
  }

  async updateClient(id: string, changes: Partial<Pick<Client, 'name' | 'description' | 'icon' | 'color'>>): Promise<void> {
    await this.supa.db('clients').update(changes).eq('id', id);
  }

  /** Deleting a client cascades to its organizations, spaces and tasks (FK on delete cascade). */
  async deleteClient(id: string): Promise<void> {
    await this.supa.db('clients').delete().eq('id', id);
  }
}

// ---- Mapping ----

function rowToClient(r: any): Client {
  return {
    id:          r.id,
    name:        r.name,
    description: r.description ?? undefined,
    icon:        r.icon,
    color:       r.color,
    createdBy:   r.created_by,
    createdAt:   toTs(r.created_at) as any,
    updatedAt:   toTs(r.updated_at) as any,
  };
}
