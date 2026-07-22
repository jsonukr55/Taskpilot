import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { RealtimeChannel } from '@supabase/supabase-js';
import { environment } from '@env/environment';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import {
  Group, GroupRole, GroupInvite, InvitePreview, canEdit,
  AssignablePerson, buildAssignablePeople
} from '@shared/models/group.model';
import { inviteToken, slugId } from '@shared/utils/id.util';
import { toTs } from './supabase-map.util';

// ============================================================
// GroupService — collaborative groups, members, invites (Supabase).
// The embedded Group model (memberIds/roles/memberProfiles) is
// reconstructed from the group_members join table via PostgREST
// resource embedding. Same public API as the Firestore version.
// ============================================================

const INVITE_TTL_DAYS = 7;
const MEMBER_SELECT = '*, group_members(user_id, role, display_name, photo_url)';

@Injectable({ providedIn: 'root' })
export class GroupService {
  private readonly supa = inject(SupabaseService);
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);

  readonly groups    = signal<Group[]>([]);
  readonly isLoading = signal(true);
  readonly error     = signal<string | null>(null);

  readonly ownedGroups = computed(() =>
    this.groups().filter(g => g.ownerId === this.auth.userId())
  );

  /** Everyone the current user can assign tasks to (self + shared-group members). */
  readonly assignablePeople = computed<AssignablePerson[]>(() =>
    buildAssignablePeople(this.groups(), {
      uid:         this.auth.userId(),
      displayName: this.auth.displayName() || 'You',
      photoURL:    this.auth.photoURL()
    })
  );

  /** Resolve assignee uids to display info, falling back for unknown members. */
  resolveAssignees(uids: string[] | undefined | null): AssignablePerson[] {
    if (!uids?.length) return [];
    const lookup = new Map(this.assignablePeople().map(p => [p.uid, p]));
    return uids.map(uid => lookup.get(uid) ?? {
      uid, displayName: 'Member', photoURL: null, isSelf: false
    });
  }

  private channel?: RealtimeChannel;

  // ---- Lifecycle ----

  startListening(): void {
    const uid = this.auth.userId();
    if (!uid) return;
    this.isLoading.set(true);

    void this.load();
    this.channel = this.supa.client
      .channel(`groups:${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'groups' },        () => void this.load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'group_members' }, () => void this.load())
      .subscribe();
  }

  stopListening(): void {
    if (this.channel) { void this.supa.client.removeChannel(this.channel); this.channel = undefined; }
  }

  private async load(): Promise<void> {
    const { data, error } = await this.supa.db('groups').select(MEMBER_SELECT);
    if (error) { this.error.set(error.message); this.isLoading.set(false); return; }
    this.groups.set((data ?? []).map(rowToGroup));
    this.isLoading.set(false);
  }

  // ---- Queries ----

  /** Reactive when called inside a computed() — reads the groups signal. */
  getGroupById(id: string): Group | undefined {
    return this.groups().find(g => g.id === id);
  }

  /** Current user's role in a group, or null if not a member. */
  myRole(group: Group | undefined): GroupRole | null {
    const uid = this.auth.userId();
    if (!group || !uid) return null;
    return group.roles[uid] ?? null;
  }

  canEditGroup(group: Group | undefined): boolean {
    return canEdit(this.myRole(group ?? undefined));
  }

  isOwner(group: Group | undefined): boolean {
    return !!group && group.ownerId === this.auth.userId();
  }

  // ---- Group CRUD ----

  async createGroup(data: { name: string; description?: string; icon: string; color: string }): Promise<string> {
    const uid = this.auth.userId();
    if (!uid) throw new Error('Not authenticated');

    const id = slugId(data.name);
    const { error } = await this.supa.db('groups').insert({
      id,
      name:        data.name.trim(),
      description: data.description?.trim() ?? '',
      icon:        data.icon,
      color:       data.color,
      owner_id:    uid,
    });
    if (error) throw error;
    await this.supa.db('group_members').insert({
      group_id:     id,
      user_id:      uid,
      role:         'owner',
      display_name: this.auth.displayName() || 'You',
      photo_url:    this.auth.photoURL() ?? null,
    });
    return id;
  }

  async updateGroup(id: string, changes: Partial<Pick<Group, 'name' | 'description' | 'icon' | 'color'>>): Promise<void> {
    await this.supa.db('groups').update(changes).eq('id', id);
  }

  /** Owner-only. Deleting the group cascades to members, notes and tasks (FK on delete cascade). */
  async deleteGroup(id: string): Promise<void> {
    await this.supa.db('groups').delete().eq('id', id);
  }

  // ---- Member management (owner-only, enforced by RLS) ----

  async changeRole(groupId: string, uid: string, role: GroupRole): Promise<void> {
    const group = this.getGroupById(groupId);
    if (group && group.ownerId === uid) throw new Error("The owner's role can't be changed.");
    await this.supa.db('group_members').update({ role }).eq('group_id', groupId).eq('user_id', uid);
  }

  async removeMember(groupId: string, uid: string): Promise<void> {
    const group = this.getGroupById(groupId);
    if (group && group.ownerId === uid) throw new Error("The owner can't be removed.");
    await this.supa.db('group_members').delete().eq('group_id', groupId).eq('user_id', uid);
  }

  // ---- Invites ----

  /** Create an invite row and return the shareable link. */
  async createInvite(group: Group, role: 'editor' | 'viewer'): Promise<{ token: string; url: string }> {
    const uid = this.auth.userId();
    if (!uid) throw new Error('Not authenticated');

    const token = inviteToken();
    const { error } = await this.supa.db('invites').insert({
      token,
      group_id:   group.id,
      group_name: group.name,
      group_icon: group.icon,
      role,
      created_by: uid,
      expires_at: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString(),
      revoked:    false,
      max_uses:   null,
      use_count:  0,
    });
    if (error) throw error;

    return { token, url: `${window.location.origin}/join/${token}` };
  }

  async listInvites(groupId: string): Promise<GroupInvite[]> {
    const { data } = await this.supa.db('invites')
      .select('*').eq('group_id', groupId).eq('revoked', false);
    return (data ?? [])
      .map(rowToInvite)
      .filter(inv => !inv.expiresAt || inv.expiresAt.toMillis() > Date.now());
  }

  async revokeInvite(token: string): Promise<void> {
    await this.supa.db('invites').update({ revoked: true }).eq('token', token);
  }

  /** Preview an invite before joining (via SECURITY DEFINER RPC — non-members can't read the row). */
  async previewInvite(token: string): Promise<{ groupName: string; groupIcon: string; role: 'editor' | 'viewer' } | null> {
    const { data, error } = await this.supa.rpc('preview_invite', { p_token: token });
    if (error || !data?.length) return null;
    const inv = data[0];
    return { groupName: inv.group_name, groupIcon: inv.group_icon, role: inv.role };
  }

  /** Redeem an invite via the joinGroup Edge Function (server-side member add). */
  async joinByToken(token: string): Promise<InvitePreview & { alreadyMember: boolean }> {
    const idToken = await this.auth.getAccessToken();
    if (!idToken) throw new Error('Not authenticated');

    return firstValueFrom(this.http.post<InvitePreview & { alreadyMember: boolean }>(
      `${environment.functionsBaseUrl}/joinGroup`,
      { token },
      { headers: { Authorization: `Bearer ${idToken}` } }
    ));
  }
}

// ---- Mapping ----

function rowToGroup(r: any): Group {
  const roles: Record<string, GroupRole> = {};
  const memberProfiles: Group['memberProfiles'] = {};
  const memberIds: string[] = [];
  for (const m of (r.group_members ?? [])) {
    memberIds.push(m.user_id);
    roles[m.user_id] = m.role;
    memberProfiles[m.user_id] = { displayName: m.display_name, photoURL: m.photo_url ?? null };
  }
  return {
    id:          r.id,
    name:        r.name,
    description: r.description ?? undefined,
    icon:        r.icon,
    color:       r.color,
    ownerId:     r.owner_id,
    memberIds,
    roles,
    memberProfiles,
    createdAt:   toTs(r.created_at) as any,
    updatedAt:   toTs(r.updated_at) as any,
  };
}

function rowToInvite(r: any): GroupInvite {
  return {
    id:        r.token,
    token:     r.token,
    groupId:   r.group_id,
    groupName: r.group_name,
    groupIcon: r.group_icon,
    role:      r.role,
    createdBy: r.created_by,
    createdAt: toTs(r.created_at) as any,
    expiresAt: toTs(r.expires_at) as any,
    revoked:   r.revoked,
    maxUses:   r.max_uses ?? null,
    useCount:  r.use_count ?? 0,
  };
}
