import { Timestamp } from '@angular/fire/firestore';

// ============================================================
// SpaceColumn — a user-defined column on a space's board (Monday-style
// custom field). Values live on each task under `customFields[column.id]`.
// ============================================================
export type SpaceColumnType = 'text' | 'number' | 'date' | 'dropdown';

export interface SpaceColumn {
  id:        string;
  spaceId:   string;
  name:      string;
  type:      SpaceColumnType;
  options:   string[];   // dropdown choices
  position:  number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const SPACE_COLUMN_TYPES: { value: SpaceColumnType; label: string }[] = [
  { value: 'text',     label: 'Text' },
  { value: 'number',   label: 'Number' },
  { value: 'date',     label: 'Date' },
  { value: 'dropdown', label: 'Dropdown' },
];
