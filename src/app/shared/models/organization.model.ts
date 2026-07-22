import { Timestamp } from '@angular/fire/firestore';

// ============================================================
// Organization Model — a top-level tenant that holds users + spaces.
// Mirrors the Group membership pattern (ownerId + memberIds[] + roles
// map + memberProfiles map, kept in sync on every change). Created by
// a global admin; users join by direct-add or invite link.
// ============================================================

export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer';

/** Roles a manager can assign to a member (owner is the special creator role). */
export const ASSIGNABLE_ORG_ROLES: Exclude<OrgRole, 'owner'>[] = ['admin', 'member', 'viewer'];

/** Denormalized member display info, keyed by uid on the org doc. */
export interface OrgMemberProfile {
  displayName: string;
  photoURL:    string | null;
}

export interface Organization {
  id:             string;
  name:           string;
  description?:   string;
  icon:           string;   // emoji
  color:          string;   // hex

  clientId:       string | null;   // parent client/customer (null = legacy/unassigned)
  ownerId:        string;   // the org owner (an admin or a designated owner)

  // Membership — kept in sync together on every join / leave / role change.
  memberIds:      string[];                            // array-contains query + rules read gate
  roles:          Record<string, OrgRole>;             // uid -> role
  memberProfiles: Record<string, OrgMemberProfile>;    // uid -> display snapshot

  createdBy:      string;
  createdAt:      Timestamp;
  updatedAt:      Timestamp;
}

/** Flattened member row for UI rendering. */
export interface OrgMember {
  userId:      string;
  role:        OrgRole;
  displayName: string;
  photoURL:    string | null;
}

export interface OrgInvite {
  id:        string;   // == token (doc id doubles as the secret)
  token:     string;
  orgId:     string;
  orgName:   string;
  orgIcon:   string;
  role:      'member';

  createdBy: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;

  revoked:   boolean;
  maxUses:   number | null;
  useCount:  number;
}

/** Preview returned by the joinOrg Cloud Function. */
export interface OrgInvitePreview {
  orgId:       string;
  orgName:     string;
  orgIcon:     string;
  role:        'member';
  memberCount: number;
  alreadyMember: boolean;
}

// ---- Helpers ----

export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  owner:  'Owner',
  admin:  'Admin',
  member: 'Member',
  viewer: 'Viewer',
};

/** Derive the flat member list from an org's uid-keyed maps. */
export function orgMembers(org: Organization): OrgMember[] {
  return org.memberIds.map(uid => ({
    userId:      uid,
    role:        org.roles[uid] ?? 'member',
    displayName: org.memberProfiles[uid]?.displayName ?? 'Member',
    photoURL:    org.memberProfiles[uid]?.photoURL ?? null,
  }));
}
