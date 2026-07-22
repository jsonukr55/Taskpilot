import { Injectable, inject, signal } from '@angular/core';
import { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import {
  Space, SpaceRole, SpaceMemberProfile, canEditSpace as canEditSpaceRole,
} from '@shared/models/space.model';
import { slugId } from '@shared/utils/id.util';
import { toTs } from './supabase-map.util';

// ============================================================
// SpaceService — projects inside an organization that hold tasks
// (Supabase). Embedded membership reconstructed from space_members.
// A global member-scoped load streams every space I belong to (across
// all orgs); org-detail filters by orgId. Same public API as before.
// ============================================================

const MEMBER_SELECT = '*, space_members(user_id, role, display_name, photo_url)';

@Injectable({ providedIn: 'root' })
export class SpaceService {
  private readonly supa = inject(SupabaseService);
  private readonly auth = inject(AuthService);

  readonly spaces    = signal<Space[]>([]);
  readonly isLoading = signal(true);

  private channel?: RealtimeChannel;

  // ---- Lifecycle ----

  startListening(): void {
    const uid = this.auth.userId();
    if (!uid) return;
    this.isLoading.set(true);

    void this.load();
    this.channel = this.supa.client
      .channel(`spaces:${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'spaces' },        () => void this.load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'space_members' }, () => void this.load())
      .subscribe();
  }

  stopListening(): void {
    if (this.channel) { void this.supa.client.removeChannel(this.channel); this.channel = undefined; }
  }

  private async load(): Promise<void> {
    const { data } = await this.supa.db('spaces').select(MEMBER_SELECT);
    this.spaces.set((data ?? []).map(rowToSpace));
    this.isLoading.set(false);
  }

  // ---- Queries ----

  /** My spaces within a given org (reactive when read in a computed). */
  spacesInOrg(orgId: string): Space[] {
    return this.spaces().filter(s => s.orgId === orgId);
  }

  getSpaceById(id: string): Space | undefined {
    return this.spaces().find(s => s.id === id);
  }

  mySpaceRole(space: Space | undefined): SpaceRole | null {
    const uid = this.auth.userId();
    if (!space || !uid) return null;
    return space.roles[uid] ?? null;
  }

  canEditSpace(space: Space | undefined): boolean {
    return canEditSpaceRole(this.mySpaceRole(space ?? undefined));
  }

  isSpaceOwner(space: Space | undefined): boolean {
    return !!space && space.ownerId === this.auth.userId();
  }

  // ---- CRUD ----

  async createSpace(orgId: string, data: { name: string; description?: string; icon: string; color: string }): Promise<string> {
    const uid = this.auth.userId();
    if (!uid) throw new Error('Not authenticated');

    const id = slugId(data.name);
    const { error } = await this.supa.db('spaces').insert({
      id,
      org_id:      orgId,
      name:        data.name.trim(),
      description: data.description?.trim() ?? '',
      icon:        data.icon,
      color:       data.color,
      owner_id:    uid,
      created_by:  uid,
    });
    if (error) throw error;
    await this.supa.db('space_members').insert({
      space_id:     id,
      user_id:      uid,
      role:         'owner',
      display_name: this.auth.displayName() || 'You',
      photo_url:    this.auth.photoURL() ?? null,
    });
    return id;
  }

  async updateSpace(id: string, changes: Partial<Pick<Space, 'name' | 'description' | 'icon' | 'color'>>): Promise<void> {
    await this.supa.db('spaces').update(changes).eq('id', id);
  }

  /** Owner-only. Deleting the space cascades to its tasks (FK on delete cascade). */
  async deleteSpace(id: string): Promise<void> {
    await this.supa.db('spaces').delete().eq('id', id);
  }

  // ---- Member management ----

  /** Add an org member to this space. The display snapshot comes from the
   *  org (the caller already has org.memberProfiles) — no server round-trip. */
  async addMember(spaceId: string, member: { uid: string; profile: SpaceMemberProfile }, role: SpaceRole = 'editor'): Promise<void> {
    const space = this.getSpaceById(spaceId);
    if (space?.memberIds.includes(member.uid)) return;
    await this.supa.db('space_members').insert({
      space_id:     spaceId,
      user_id:      member.uid,
      role,
      display_name: member.profile.displayName,
      photo_url:    member.profile.photoURL ?? null,
    });
  }

  async changeRole(spaceId: string, uid: string, role: SpaceRole): Promise<void> {
    const space = this.getSpaceById(spaceId);
    if (space && space.ownerId === uid) throw new Error("The owner's role can't be changed.");
    await this.supa.db('space_members').update({ role }).eq('space_id', spaceId).eq('user_id', uid);
  }

  async removeMember(spaceId: string, uid: string): Promise<void> {
    const space = this.getSpaceById(spaceId);
    if (space && space.ownerId === uid) throw new Error("The owner can't be removed.");
    await this.supa.db('space_members').delete().eq('space_id', spaceId).eq('user_id', uid);
  }
}

// ---- Mapping ----

function rowToSpace(r: any): Space {
  const roles: Record<string, SpaceRole> = {};
  const memberProfiles: Space['memberProfiles'] = {};
  const memberIds: string[] = [];
  for (const m of (r.space_members ?? [])) {
    memberIds.push(m.user_id);
    roles[m.user_id] = m.role;
    memberProfiles[m.user_id] = { displayName: m.display_name, photoURL: m.photo_url ?? null };
  }
  return {
    id:          r.id,
    orgId:       r.org_id,
    name:        r.name,
    description: r.description ?? undefined,
    icon:        r.icon,
    color:       r.color,
    ownerId:     r.owner_id,
    memberIds,
    roles,
    memberProfiles,
    createdBy:   r.created_by,
    createdAt:   toTs(r.created_at) as any,
    updatedAt:   toTs(r.updated_at) as any,
  };
}
