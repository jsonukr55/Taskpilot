import { Timestamp } from '@angular/fire/firestore';

// ============================================================
// Group Model — collaborative workspace with role-based access
// ============================================================

export type GroupRole = 'owner' | 'editor' | 'viewer';

/** Denormalized member display info, keyed by uid on the group doc. */
export interface GroupMemberProfile {
  displayName: string;
  photoURL:    string | null;
}

export interface Group {
  id:             string;
  name:           string;
  description?:   string;
  icon:           string;   // emoji (matches Category convention)
  color:          string;   // hex

  ownerId:        string;

  // Membership — kept in sync together on every join / leave / role change.
  memberIds:      string[];                          // for array-contains query + rules read gate
  roles:          Record<string, GroupRole>;         // uid -> role, for rules write gate
  memberProfiles: Record<string, GroupMemberProfile>; // uid -> display snapshot (UI)

  createdAt:      Timestamp;
  updatedAt:      Timestamp;
}

/** Flattened member row for UI rendering. */
export interface GroupMember {
  userId:      string;
  role:        GroupRole;
  displayName: string;
  photoURL:    string | null;
}

export interface GroupInvite {
  id:        string;   // == token (the doc id doubles as the secret)
  token:     string;
  groupId:   string;
  groupName: string;
  groupIcon: string;   // for a nicer pre-join preview (non-members can't read the group doc)
  role:      'editor' | 'viewer';

  createdBy: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;

  revoked:   boolean;
  maxUses:   number | null;
  useCount:  number;
}

/** Preview returned by the joinGroup Cloud Function. */
export interface InvitePreview {
  groupId:   string;
  groupName: string;
  groupIcon: string;
  role:      'editor' | 'viewer';
  memberCount: number;
}

// ---- Helpers ----

export const ROLE_LABELS: Record<GroupRole, string> = {
  owner:  'Owner',
  editor: 'Editor',
  viewer: 'Viewer'
};

/** Can this role create/modify notes and tasks in the group? */
export function canEdit(role: GroupRole | undefined | null): boolean {
  return role === 'owner' || role === 'editor';
}

/** Derive the flat member list from a group's uid-keyed maps. */
export function groupMembers(group: Group): GroupMember[] {
  return group.memberIds.map(uid => ({
    userId:      uid,
    role:        group.roles[uid] ?? 'viewer',
    displayName: group.memberProfiles[uid]?.displayName ?? 'Member',
    photoURL:    group.memberProfiles[uid]?.photoURL ?? null
  }));
}
