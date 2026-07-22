import { Timestamp } from '@angular/fire/firestore';

// ============================================================
// Space Model — a "project" inside an organization that holds tasks
// and subtasks. Mirrors the Group membership pattern; a space belongs
// to exactly one organization (orgId) and has its own member list
// (a subset of the org's members, with per-space roles).
// ============================================================

export type SpaceRole = 'owner' | 'editor' | 'viewer';

export interface SpaceMemberProfile {
  displayName: string;
  photoURL:    string | null;
}

export interface Space {
  id:             string;
  orgId:          string;   // parent organization
  name:           string;
  description?:   string;
  icon:           string;   // emoji
  color:          string;   // hex

  ownerId:        string;

  memberIds:      string[];
  roles:          Record<string, SpaceRole>;
  memberProfiles: Record<string, SpaceMemberProfile>;

  createdBy:      string;
  createdAt:      Timestamp;
  updatedAt:      Timestamp;
}

export interface SpaceMember {
  userId:      string;
  role:        SpaceRole;
  displayName: string;
  photoURL:    string | null;
}

// ---- Helpers ----

export const SPACE_ROLE_LABELS: Record<SpaceRole, string> = {
  owner:  'Owner',
  editor: 'Editor',
  viewer: 'Viewer',
};

/** Can this role create/modify tasks in the space? */
export function canEditSpace(role: SpaceRole | undefined | null): boolean {
  return role === 'owner' || role === 'editor';
}

export function spaceMembers(space: Space): SpaceMember[] {
  return space.memberIds.map(uid => ({
    userId:      uid,
    role:        space.roles[uid] ?? 'viewer',
    displayName: space.memberProfiles[uid]?.displayName ?? 'Member',
    photoURL:    space.memberProfiles[uid]?.photoURL ?? null,
  }));
}
