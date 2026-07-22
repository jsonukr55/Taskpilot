import { Injectable, inject, signal } from '@angular/core';
import {
  Firestore, collection, query, where, onSnapshot,
  doc, setDoc, updateDoc, getDocs,
  serverTimestamp, writeBatch, deleteField
} from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import {
  Space, SpaceRole, SpaceMemberProfile, canEditSpace as canEditSpaceRole,
} from '@shared/models/space.model';
import { slugId } from '@shared/utils/id.util';

// ============================================================
// SpaceService — projects inside an organization that hold tasks.
// Mirrors GroupService. A global member-scoped listener streams every
// space I belong to (across all orgs); org-detail filters by orgId.
// Space membership is a subset of the org's members, so adding a member
// is a plain client write (the display snapshot comes from the org).
// ============================================================

@Injectable({ providedIn: 'root' })
export class SpaceService {
  private readonly firestore = inject(Firestore);
  private readonly auth      = inject(AuthService);

  readonly spaces    = signal<Space[]>([]);
  readonly isLoading = signal(true);

  private unsubscribe?: () => void;

  // ---- Lifecycle ----

  startListening(): void {
    const uid = this.auth.userId();
    if (!uid) return;
    this.isLoading.set(true);

    const q = query(
      collection(this.firestore, 'spaces'),
      where('memberIds', 'array-contains', uid)
    );

    this.unsubscribe = onSnapshot(q, snapshot => {
      this.spaces.set(snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Space)));
      this.isLoading.set(false);
    }, () => this.isLoading.set(false));
  }

  stopListening(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
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
    await setDoc(doc(this.firestore, 'spaces', id), {
      orgId,
      name:        data.name.trim(),
      description: data.description?.trim() ?? '',
      icon:        data.icon,
      color:       data.color,
      ownerId:     uid,
      memberIds:   [uid],
      roles:       { [uid]: 'owner' as SpaceRole },
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

  async updateSpace(id: string, changes: Partial<Pick<Space, 'name' | 'description' | 'icon' | 'color'>>): Promise<void> {
    await updateDoc(doc(this.firestore, 'spaces', id), { ...changes, updatedAt: serverTimestamp() });
  }

  /** Owner-only. Deletes the space's tasks (chunked), then the space doc. */
  async deleteSpace(id: string): Promise<void> {
    const tasksSnap = await getDocs(query(collection(this.firestore, 'tasks'), where('spaceId', '==', id)));
    const refs = [...tasksSnap.docs.map(d => d.ref), doc(this.firestore, 'spaces', id)];
    const LIMIT = 400;
    for (let i = 0; i < refs.length; i += LIMIT) {
      const batch = writeBatch(this.firestore);
      refs.slice(i, i + LIMIT).forEach(ref => batch.delete(ref));
      await batch.commit();
    }
  }

  // ---- Member management ----

  /** Add an org member to this space. The display snapshot comes from the
   *  org (the caller already has org.memberProfiles) — no server round-trip. */
  async addMember(spaceId: string, member: { uid: string; profile: SpaceMemberProfile }, role: SpaceRole = 'editor'): Promise<void> {
    const space = this.getSpaceById(spaceId);
    if (space?.memberIds.includes(member.uid)) return;
    await updateDoc(doc(this.firestore, 'spaces', spaceId), {
      memberIds: [...(space?.memberIds ?? []), member.uid],
      [`roles.${member.uid}`]:          role,
      [`memberProfiles.${member.uid}`]: member.profile,
      updatedAt: serverTimestamp(),
    });
  }

  async changeRole(spaceId: string, uid: string, role: SpaceRole): Promise<void> {
    const space = this.getSpaceById(spaceId);
    if (space && space.ownerId === uid) throw new Error("The owner's role can't be changed.");
    await updateDoc(doc(this.firestore, 'spaces', spaceId), {
      [`roles.${uid}`]: role,
      updatedAt: serverTimestamp(),
    });
  }

  async removeMember(spaceId: string, uid: string): Promise<void> {
    const space = this.getSpaceById(spaceId);
    if (space && space.ownerId === uid) throw new Error("The owner can't be removed.");
    await updateDoc(doc(this.firestore, 'spaces', spaceId), {
      memberIds: (space?.memberIds ?? []).filter(m => m !== uid),
      [`roles.${uid}`]:          deleteField(),
      [`memberProfiles.${uid}`]: deleteField(),
      updatedAt: serverTimestamp(),
    });
  }
}
