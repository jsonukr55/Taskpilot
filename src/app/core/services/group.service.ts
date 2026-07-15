import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import {
  Firestore, collection, query, where, onSnapshot,
  doc, addDoc, setDoc, updateDoc, getDoc, getDocs,
  serverTimestamp, Timestamp, writeBatch, deleteField
} from '@angular/fire/firestore';
import { environment } from '@env/environment';
import { AuthService } from './auth.service';
import {
  Group, GroupRole, GroupInvite, InvitePreview, canEdit,
  AssignablePerson, buildAssignablePeople
} from '@shared/models/group.model';
import { inviteToken, slugId } from '@shared/utils/id.util';

// ============================================================
// GroupService — collaborative groups, members, invites
// Mirrors TaskService's onSnapshot→signals lifecycle.
// ============================================================

const INVITE_TTL_DAYS = 7;

@Injectable({ providedIn: 'root' })
export class GroupService {
  private readonly firestore = inject(Firestore);
  private readonly auth      = inject(AuthService);
  private readonly http      = inject(HttpClient);

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

  private unsubscribe?: () => void;

  // ---- Lifecycle ----

  startListening(): void {
    const uid = this.auth.userId();
    if (!uid) return;
    this.isLoading.set(true);

    const q = query(
      collection(this.firestore, 'groups'),
      where('memberIds', 'array-contains', uid)
    );

    this.unsubscribe = onSnapshot(q, snapshot => {
      this.groups.set(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Group)));
      this.isLoading.set(false);
    }, err => {
      this.error.set(err.message);
      this.isLoading.set(false);
    });
  }

  stopListening(): void {
    this.unsubscribe?.();
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
    await setDoc(doc(this.firestore, 'groups', id), {
      name:        data.name.trim(),
      description: data.description?.trim() ?? '',
      icon:        data.icon,
      color:       data.color,
      ownerId:     uid,
      memberIds:   [uid],
      roles:       { [uid]: 'owner' as GroupRole },
      memberProfiles: {
        [uid]: {
          displayName: this.auth.displayName() || 'You',
          photoURL:    this.auth.photoURL() ?? null
        }
      },
      createdAt:   serverTimestamp(),
      updatedAt:   serverTimestamp()
    });
    return id;
  }

  async updateGroup(id: string, changes: Partial<Pick<Group, 'name' | 'description' | 'icon' | 'color'>>): Promise<void> {
    await updateDoc(doc(this.firestore, 'groups', id), { ...changes, updatedAt: serverTimestamp() });
  }

  /** Owner-only. Deletes the group + its notes (comments are orphaned but become inaccessible). */
  async deleteGroup(id: string): Promise<void> {
    const notesSnap = await getDocs(collection(this.firestore, 'groups', id, 'notes'));
    const batch = writeBatch(this.firestore);
    notesSnap.docs.forEach(n => batch.delete(n.ref));
    batch.delete(doc(this.firestore, 'groups', id));
    await batch.commit();
  }

  // ---- Member management (owner-only, enforced by rules) ----

  async changeRole(groupId: string, uid: string, role: GroupRole): Promise<void> {
    const group = this.getGroupById(groupId);
    if (group && group.ownerId === uid) throw new Error("The owner's role can't be changed.");
    await updateDoc(doc(this.firestore, 'groups', groupId), {
      [`roles.${uid}`]: role,
      updatedAt: serverTimestamp()
    });
  }

  async removeMember(groupId: string, uid: string): Promise<void> {
    const group = this.getGroupById(groupId);
    if (group && group.ownerId === uid) throw new Error("The owner can't be removed.");
    await updateDoc(doc(this.firestore, 'groups', groupId), {
      memberIds: (group?.memberIds ?? []).filter(m => m !== uid),
      [`roles.${uid}`]:          deleteField(),
      [`memberProfiles.${uid}`]: deleteField(),
      updatedAt: serverTimestamp()
    });
  }

  // ---- Invites ----

  /** Create an invite doc and return the shareable link. */
  async createInvite(group: Group, role: 'editor' | 'viewer'): Promise<{ token: string; url: string }> {
    const uid = this.auth.userId();
    if (!uid) throw new Error('Not authenticated');

    const token = inviteToken();
    const expiresAt = Timestamp.fromDate(new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000));

    await setDoc(doc(this.firestore, 'invites', token), {
      token,
      groupId:   group.id,
      groupName: group.name,
      groupIcon: group.icon,
      role,
      createdBy: uid,
      createdAt: serverTimestamp(),
      expiresAt,
      revoked:   false,
      maxUses:   null,
      useCount:  0
    });

    return { token, url: `${window.location.origin}/join/${token}` };
  }

  async listInvites(groupId: string): Promise<GroupInvite[]> {
    const snap = await getDocs(query(
      collection(this.firestore, 'invites'),
      where('groupId', '==', groupId),
      where('revoked', '==', false)
    ));
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() } as GroupInvite))
      .filter(inv => !inv.expiresAt || inv.expiresAt.toMillis() > Date.now());
  }

  async revokeInvite(token: string): Promise<void> {
    await updateDoc(doc(this.firestore, 'invites', token), { revoked: true });
  }

  /** Preview an invite before joining. Reads by doc id (a get(), allowed for any
   *  signed-in user) rather than a query (list), which the rules restrict to editors. */
  async previewInvite(token: string): Promise<{ groupName: string; groupIcon: string; role: 'editor' | 'viewer' } | null> {
    try {
      const snap = await getDoc(doc(this.firestore, 'invites', token));
      if (!snap.exists()) return null;
      const inv = snap.data() as GroupInvite;
      if (inv.revoked || (inv.expiresAt && inv.expiresAt.toMillis() < Date.now())) return null;
      return { groupName: inv.groupName, groupIcon: inv.groupIcon, role: inv.role };
    } catch {
      return null;
    }
  }

  /** Redeem an invite via the joinGroup Cloud Function (server-side member add). */
  async joinByToken(token: string): Promise<InvitePreview & { alreadyMember: boolean }> {
    const idToken = await this.auth.currentUser()?.getIdToken();
    if (!idToken) throw new Error('Not authenticated');

    return firstValueFrom(this.http.post<InvitePreview & { alreadyMember: boolean }>(
      `${environment.functionsBaseUrl}/joinGroup`,
      { token },
      { headers: { Authorization: `Bearer ${idToken}` } }
    ));
  }
}
