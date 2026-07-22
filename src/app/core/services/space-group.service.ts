import { Injectable, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { SpaceGroup, SPACE_GROUP_COLORS } from '@shared/models/space-group.model';
import { toTs } from './supabase-map.util';

// ============================================================
// SpaceGroupService — board sections ("Groups") for the open space.
// Same signal + realtime-refetch lifecycle as the other services.
// ============================================================
@Injectable({ providedIn: 'root' })
export class SpaceGroupService {
  private readonly supa = inject(SupabaseService);

  readonly groups    = signal<SpaceGroup[]>([]);
  readonly isLoading = signal(true);

  private channel?: RealtimeChannel;

  // ---- Lifecycle (scoped to one open space) ----

  open(spaceId: string): void {
    this.close();
    this.isLoading.set(true);
    void this.load(spaceId);
    this.channel = this.supa.client
      .channel(`space-groups:${spaceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'space_groups', filter: `space_id=eq.${spaceId}` },
        () => void this.load(spaceId))
      .subscribe();
  }

  close(): void {
    if (this.channel) { void this.supa.client.removeChannel(this.channel); this.channel = undefined; }
    this.groups.set([]);
  }

  private async load(spaceId: string): Promise<void> {
    const { data } = await this.supa.db('space_groups')
      .select('*').eq('space_id', spaceId).order('position');
    this.groups.set((data ?? []).map(rowToSpaceGroup));
    this.isLoading.set(false);
  }

  // ---- CRUD ----

  async create(spaceId: string, name = 'New group'): Promise<string> {
    const position = this.groups().length;
    const color = SPACE_GROUP_COLORS[position % SPACE_GROUP_COLORS.length];
    const { data, error } = await this.supa.db('space_groups')
      .insert({ space_id: spaceId, name: name.trim() || 'New group', color, position })
      .select('id').single();
    if (error) throw error;
    return data.id;
  }

  async update(id: string, changes: Partial<Pick<SpaceGroup, 'name' | 'color' | 'position'>>): Promise<void> {
    await this.supa.db('space_groups').update(changes).eq('id', id);
  }

  /** Delete a section. Tasks in it become ungrouped (FK on delete set null). */
  async remove(id: string): Promise<void> {
    await this.supa.db('space_groups').delete().eq('id', id);
  }

  async reorder(orderedIds: string[]): Promise<void> {
    await Promise.all(orderedIds.map((id, i) =>
      this.supa.db('space_groups').update({ position: i }).eq('id', id)
    ));
  }
}

// ---- Mapping ----

function rowToSpaceGroup(r: any): SpaceGroup {
  return {
    id:        r.id,
    spaceId:   r.space_id,
    name:      r.name,
    color:     r.color,
    position:  r.position ?? 0,
    createdAt: toTs(r.created_at) as any,
    updatedAt: toTs(r.updated_at) as any,
  };
}
