import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { RealtimeChannel } from '@supabase/supabase-js';
import { environment } from '@env/environment';
import { SupabaseService } from './supabase.service';
import { AuthService } from './auth.service';
import {
  Organization, OrgRole, OrgInvite, OrgInvitePreview,
} from '@shared/models/organization.model';
import { inviteToken, slugId } from '@shared/utils/id.util';
import { toTs } from './supabase-map.util';

// ============================================================
// OrganizationService — top-level tenants that hold users + spaces
// (Supabase). Embedded membership reconstructed from org_members.
// Orgs can only be CREATED by a global admin (enforced by RLS).
// Same public API as the Firestore version.
// ============================================================

const INVITE_TTL_DAYS = 7;
const MEMBER_SELECT = '*, org_members(user_id, role, display_name, photo_url)';

@Injectable({ providedIn: 'root' })
export class OrganizationService {
  private readonly supa = inject(SupabaseService);
  private readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);

  readonly organizations = signal<Organization[]>([]);
  readonly isLoading     = signal(true);
  readonly error         = signal<string | null>(null);

  readonly ownedOrganizations = computed(() =>
    this.organizations().filter(o => o.ownerId === this.auth.userId())
  );

  /** Organizations belonging to a given client (reactive in a computed). */
  orgsInClient(clientId: string): Organization[] {
    return this.organizations().filter(o => o.clientId === clientId);
  }

  private channel?: RealtimeChannel;

  // ---- Lifecycle ----

  startListening(): void {
    const uid = this.auth.userId();
    if (!uid) return;
    this.isLoading.set(true);

    void this.load();
    this.channel = this.supa.client
      .channel(`organizations:${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'organizations' }, () => void this.load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'org_members' },    () => void this.load())
      .subscribe();
  }

  stopListening(): void {
    if (this.channel) { void this.supa.client.removeChannel(this.channel); this.channel = undefined; }
  }

  private async load(): Promise<void> {
    const { data, error } = await this.supa.db('organizations').select(MEMBER_SELECT);
    if (error) { this.error.set(error.message); this.isLoading.set(false); return; }
    this.organizations.set((data ?? []).map(rowToOrg));
    this.isLoading.set(false);
  }

  // ---- Queries ----

  getOrgById(id: string): Organization | undefined {
    return this.organizations().find(o => o.id === id);
  }

  myOrgRole(org: Organization | undefined): OrgRole | null {
    const uid = this.auth.userId();
    if (!org || !uid) return null;
    return org.roles[uid] ?? null;
  }

  isOrgOwner(org: Organization | undefined): boolean {
    return !!org && org.ownerId === this.auth.userId();
  }

  /** Owner, org admin, OR platform admin can manage the org's members. */
  canManageOrg(org: Organization | undefined): boolean {
    return this.isOrgOwner(org) || this.auth.isAdmin() || this.myOrgRole(org) === 'admin';
  }

  // ---- Org CRUD (create requires admin, enforced by RLS) ----

  async createOrganization(data: { name: string; description?: string; icon: string; color: string; clientId?: string | null }): Promise<string> {
    const uid = this.auth.userId();
    if (!uid) throw new Error('Not authenticated');

    const id = slugId(data.name);
    const { error } = await this.supa.db('organizations').insert({
      id,
      name:        data.name.trim(),
      description: data.description?.trim() ?? '',
      icon:        data.icon,
      color:       data.color,
      client_id:   data.clientId ?? null,
      owner_id:    uid,
      created_by:  uid,
    });
    if (error) throw error;
    await this.supa.db('org_members').insert({
      org_id:       id,
      user_id:      uid,
      role:         'owner',
      display_name: this.auth.displayName() || 'You',
      photo_url:    this.auth.photoURL() ?? null,
    });
    return id;
  }

  async updateOrganization(id: string, changes: Partial<Pick<Organization, 'name' | 'description' | 'icon' | 'color'>>): Promise<void> {
    await this.supa.db('organizations').update(changes).eq('id', id);
  }

  /** Owner/admin only. Deleting the org cascades to spaces and their tasks (FK on delete cascade). */
  async deleteOrganization(id: string): Promise<void> {
    await this.supa.db('organizations').delete().eq('id', id);
  }

  // ---- Member management (owner/admin, enforced by RLS) ----

  async removeMember(orgId: string, uid: string): Promise<void> {
    const org = this.getOrgById(orgId);
    if (org && org.ownerId === uid) throw new Error("The owner can't be removed.");
    await this.supa.db('org_members').delete().eq('org_id', orgId).eq('user_id', uid);
  }

  /** Change a member's org role (Admin / Member / Viewer). The owner is fixed. */
  async changeRole(orgId: string, uid: string, role: OrgRole): Promise<void> {
    const org = this.getOrgById(orgId);
    if (org && org.ownerId === uid) throw new Error("The owner's role can't be changed.");
    await this.supa.db('org_members').update({ role }).eq('org_id', orgId).eq('user_id', uid);
  }

  /** Add an existing user to the org by email (resolves uid + profile server-side). */
  async addMemberByEmail(orgId: string, email: string): Promise<{ uid: string; displayName: string }> {
    const idToken = await this.auth.getAccessToken();
    if (!idToken) throw new Error('Not authenticated');
    return firstValueFrom(this.http.post<{ uid: string; displayName: string }>(
      `${environment.functionsBaseUrl}/addOrgMember`,
      { orgId, email: email.trim() },
      { headers: { Authorization: `Bearer ${idToken}` } }
    ));
  }

  // ---- Invites (org_invites table) ----

  async createInvite(org: Organization): Promise<{ token: string; url: string }> {
    const uid = this.auth.userId();
    if (!uid) throw new Error('Not authenticated');

    const token = inviteToken();
    const { error } = await this.supa.db('org_invites').insert({
      token,
      org_id:     org.id,
      org_name:   org.name,
      org_icon:   org.icon,
      role:       'member',
      created_by: uid,
      expires_at: new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000).toISOString(),
      revoked:    false,
      max_uses:   null,
      use_count:  0,
    });
    if (error) throw error;

    return { token, url: `${window.location.origin}/org-join/${token}` };
  }

  async listInvites(orgId: string): Promise<OrgInvite[]> {
    const { data } = await this.supa.db('org_invites')
      .select('*').eq('org_id', orgId).eq('revoked', false);
    return (data ?? [])
      .map(rowToOrgInvite)
      .filter(inv => !inv.expiresAt || inv.expiresAt.toMillis() > Date.now());
  }

  async revokeInvite(token: string): Promise<void> {
    await this.supa.db('org_invites').update({ revoked: true }).eq('token', token);
  }

  async previewInvite(token: string): Promise<{ orgName: string; orgIcon: string } | null> {
    const { data, error } = await this.supa.rpc('preview_org_invite', { p_token: token });
    if (error || !data?.length) return null;
    return { orgName: data[0].org_name, orgIcon: data[0].org_icon };
  }

  /** Redeem an org invite via the joinOrg Edge Function. */
  async joinByToken(token: string): Promise<OrgInvitePreview> {
    const idToken = await this.auth.getAccessToken();
    if (!idToken) throw new Error('Not authenticated');
    return firstValueFrom(this.http.post<OrgInvitePreview>(
      `${environment.functionsBaseUrl}/joinOrg`,
      { token },
      { headers: { Authorization: `Bearer ${idToken}` } }
    ));
  }
}

// ---- Mapping ----

function rowToOrg(r: any): Organization {
  const roles: Record<string, OrgRole> = {};
  const memberProfiles: Organization['memberProfiles'] = {};
  const memberIds: string[] = [];
  for (const m of (r.org_members ?? [])) {
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
    clientId:    r.client_id ?? null,
    ownerId:     r.owner_id,
    memberIds,
    roles,
    memberProfiles,
    createdBy:   r.created_by,
    createdAt:   toTs(r.created_at) as any,
    updatedAt:   toTs(r.updated_at) as any,
  };
}

function rowToOrgInvite(r: any): OrgInvite {
  return {
    id:        r.token,
    token:     r.token,
    orgId:     r.org_id,
    orgName:   r.org_name,
    orgIcon:   r.org_icon,
    role:      'member',
    createdBy: r.created_by,
    createdAt: toTs(r.created_at) as any,
    expiresAt: toTs(r.expires_at) as any,
    revoked:   r.revoked,
    maxUses:   r.max_uses ?? null,
    useCount:  r.use_count ?? 0,
  };
}
