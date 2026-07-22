import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  Firestore, collection, query, where, onSnapshot,
  doc, setDoc, updateDoc, getDoc, getDocs,
  serverTimestamp, Timestamp, writeBatch, deleteField
} from '@angular/fire/firestore';
import { environment } from '@env/environment';
import { AuthService } from './auth.service';
import {
  Organization, OrgRole, OrgInvite, OrgInvitePreview,
} from '@shared/models/organization.model';
import { inviteToken, slugId } from '@shared/utils/id.util';

// ============================================================
// OrganizationService — top-level tenants that hold users + spaces.
// Mirrors GroupService (onSnapshot → signal lifecycle, membership maps,
// invites). Orgs can only be CREATED by a global admin (enforced by
// rules); membership is managed by the org owner (or admin).
// ============================================================

const INVITE_TTL_DAYS = 7;

@Injectable({ providedIn: 'root' })
export class OrganizationService {
  private readonly firestore = inject(Firestore);
  private readonly auth      = inject(AuthService);
  private readonly http      = inject(HttpClient);

  readonly organizations = signal<Organization[]>([]);
  readonly isLoading     = signal(true);
  readonly error         = signal<string | null>(null);

  readonly ownedOrganizations = computed(() =>
    this.organizations().filter(o => o.ownerId === this.auth.userId())
  );

  private unsubscribe?: () => void;

  // ---- Lifecycle ----

  startListening(): void {
    const uid = this.auth.userId();
    if (!uid) return;
    this.isLoading.set(true);

    const q = query(
      collection(this.firestore, 'organizations'),
      where('memberIds', 'array-contains', uid)
    );

    this.unsubscribe = onSnapshot(q, snapshot => {
      this.organizations.set(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Organization)));
      this.isLoading.set(false);
    }, err => {
      this.error.set(err.message);
      this.isLoading.set(false);
    });
  }

  stopListening(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
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

  /** Owner OR platform admin can manage the org. */
  canManageOrg(org: Organization | undefined): boolean {
    return this.isOrgOwner(org) || this.auth.isAdmin();
  }

  // ---- Org CRUD (create requires admin, enforced by rules) ----

  async createOrganization(data: { name: string; description?: string; icon: string; color: string }): Promise<string> {
    const uid = this.auth.userId();
    if (!uid) throw new Error('Not authenticated');

    const id = slugId(data.name);
    await setDoc(doc(this.firestore, 'organizations', id), {
      name:        data.name.trim(),
      description: data.description?.trim() ?? '',
      icon:        data.icon,
      color:       data.color,
      ownerId:     uid,
      memberIds:   [uid],
      roles:       { [uid]: 'owner' as OrgRole },
      memberProfiles: {
        [uid]: {
          displayName: this.auth.displayName() || 'You',
          photoURL:    this.auth.photoURL() ?? null,
        }
      },
      createdBy:   uid,
      createdAt:   serverTimestamp(),
      updatedAt:   serverTimestamp(),
    });
    return id;
  }

  async updateOrganization(id: string, changes: Partial<Pick<Organization, 'name' | 'description' | 'icon' | 'color'>>): Promise<void> {
    await updateDoc(doc(this.firestore, 'organizations', id), { ...changes, updatedAt: serverTimestamp() });
  }

  /**
   * Owner/admin only. Fan-out delete: every space in the org and all their
   * tasks, then the org itself (top-level collections don't cascade). Chunked
   * to respect Firestore's batch limit.
   */
  async deleteOrganization(id: string): Promise<void> {
    const spacesSnap = await getDocs(query(collection(this.firestore, 'spaces'), where('orgId', '==', id)));
    for (const spaceDoc of spacesSnap.docs) {
      const tasksSnap = await getDocs(query(collection(this.firestore, 'tasks'), where('spaceId', '==', spaceDoc.id)));
      await this.deleteInChunks(tasksSnap.docs.map(d => d.ref));
    }
    await this.deleteInChunks(spacesSnap.docs.map(d => d.ref));
    await this.deleteInChunks([doc(this.firestore, 'organizations', id)]);
  }

  private async deleteInChunks(refs: ReturnType<typeof doc>[]): Promise<void> {
    const LIMIT = 400;
    for (let i = 0; i < refs.length; i += LIMIT) {
      const batch = writeBatch(this.firestore);
      refs.slice(i, i + LIMIT).forEach(ref => batch.delete(ref));
      await batch.commit();
    }
  }

  // ---- Member management (owner/admin, enforced by rules) ----

  async removeMember(orgId: string, uid: string): Promise<void> {
    const org = this.getOrgById(orgId);
    if (org && org.ownerId === uid) throw new Error("The owner can't be removed.");
    await updateDoc(doc(this.firestore, 'organizations', orgId), {
      memberIds: (org?.memberIds ?? []).filter(m => m !== uid),
      [`roles.${uid}`]:          deleteField(),
      [`memberProfiles.${uid}`]: deleteField(),
      updatedAt: serverTimestamp(),
    });
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

  // ---- Invites (separate orgInvites collection) ----

  async createInvite(org: Organization): Promise<{ token: string; url: string }> {
    const uid = this.auth.userId();
    if (!uid) throw new Error('Not authenticated');

    const token = inviteToken();
    const expiresAt = Timestamp.fromDate(new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000));

    await setDoc(doc(this.firestore, 'orgInvites', token), {
      token,
      orgId:    org.id,
      orgName:  org.name,
      orgIcon:  org.icon,
      role:     'member',
      createdBy: uid,
      createdAt: serverTimestamp(),
      expiresAt,
      revoked:  false,
      maxUses:  null,
      useCount: 0,
    });

    return { token, url: `${window.location.origin}/org-join/${token}` };
  }

  async listInvites(orgId: string): Promise<OrgInvite[]> {
    const snap = await getDocs(query(
      collection(this.firestore, 'orgInvites'),
      where('orgId', '==', orgId),
      where('revoked', '==', false)
    ));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() } as OrgInvite))
      .filter(inv => !inv.expiresAt || inv.expiresAt.toMillis() > Date.now());
  }

  async revokeInvite(token: string): Promise<void> {
    await updateDoc(doc(this.firestore, 'orgInvites', token), { revoked: true });
  }

  async previewInvite(token: string): Promise<{ orgName: string; orgIcon: string } | null> {
    try {
      const snap = await getDoc(doc(this.firestore, 'orgInvites', token));
      if (!snap.exists()) return null;
      const inv = snap.data() as OrgInvite;
      if (inv.revoked || (inv.expiresAt && inv.expiresAt.toMillis() < Date.now())) return null;
      return { orgName: inv.orgName, orgIcon: inv.orgIcon };
    } catch {
      return null;
    }
  }

  /** Redeem an org invite via the joinOrg Cloud Function. */
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
