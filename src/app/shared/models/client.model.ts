import { Timestamp } from '@angular/fire/firestore';

// ============================================================
// Client / Customer Model — the top-level tenant, created by the
// global super-admin. Organizations (and their spaces/tasks) nest
// under a client. Groups and personal tasks are a separate, parallel
// layer and are NOT scoped to a client.
// ============================================================

export interface Client {
  id:           string;
  name:         string;
  description?: string;
  icon:         string;   // emoji
  color:        string;   // hex

  createdBy:    string;
  createdAt:    Timestamp;
  updatedAt:    Timestamp;
}
