import { Injectable, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { SpaceColumn, SpaceColumnType } from '@shared/models/space-column.model';
import { toTs } from './supabase-map.util';

// ============================================================
// SpaceColumnService — custom board columns for the open space.
// Same signal + realtime-refetch lifecycle as the other services.
// ============================================================
@Injectable({ providedIn: 'root' })
export class SpaceColumnService {
  private readonly supa = inject(SupabaseService);

  readonly columns = signal<SpaceColumn[]>([]);
  private channel?: RealtimeChannel;

  open(spaceId: string): void {
    this.close();
    void this.load(spaceId);
    this.channel = this.supa.client
      .channel(`space-columns:${spaceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'space_columns', filter: `space_id=eq.${spaceId}` },
        () => void this.load(spaceId))
      .subscribe();
  }

  close(): void {
    if (this.channel) { void this.supa.client.removeChannel(this.channel); this.channel = undefined; }
    this.columns.set([]);
  }

  private async load(spaceId: string): Promise<void> {
    const { data } = await this.supa.db('space_columns')
      .select('*').eq('space_id', spaceId).order('position');
    this.columns.set((data ?? []).map(rowToColumn));
  }

  async create(spaceId: string, name: string, type: SpaceColumnType, options: string[] = []): Promise<string> {
    const position = this.columns().length;
    const { data, error } = await this.supa.db('space_columns')
      .insert({ space_id: spaceId, name: name.trim() || 'Column', type, options, position })
      .select('id').single();
    if (error) throw error;
    return data.id;
  }

  async update(id: string, changes: Partial<Pick<SpaceColumn, 'name' | 'options' | 'position'>>): Promise<void> {
    await this.supa.db('space_columns').update(changes).eq('id', id);
  }

  async remove(id: string): Promise<void> {
    await this.supa.db('space_columns').delete().eq('id', id);
  }
}

// ---- Mapping ----

function rowToColumn(r: any): SpaceColumn {
  return {
    id:        r.id,
    spaceId:   r.space_id,
    name:      r.name,
    type:      r.type,
    options:   r.options ?? [],
    position:  r.position ?? 0,
    createdAt: toTs(r.created_at) as any,
    updatedAt: toTs(r.updated_at) as any,
  };
}
