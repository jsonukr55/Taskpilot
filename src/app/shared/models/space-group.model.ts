import { Timestamp } from '@angular/fire/firestore';

// ============================================================
// SpaceGroup — a "Group" / section inside a Space (board), the
// Monday.com "Group" concept. NOT the legacy collaborative `groups`.
// Tasks reference it via `spaceGroupId`.
// ============================================================
export interface SpaceGroup {
  id:        string;
  spaceId:   string;
  name:      string;
  color:     string;   // hex — the section's accent
  position:  number;   // order within the board
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const SPACE_GROUP_COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#f43f5e',
  '#8b5cf6', '#0ea5e9', '#ec4899', '#14b8a6',
];
