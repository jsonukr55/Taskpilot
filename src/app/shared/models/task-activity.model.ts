import { Timestamp } from '@angular/fire/firestore';

// ============================================================
// Task activity — an audit-feed entry recorded server-side when a
// task is created or a tracked field changes.
// ============================================================

export interface TaskActivity {
  id:        string;
  taskId:    string;
  actorId:   string | null;
  actorName: string | null;
  action:    'created' | 'updated' | string;
  field:     string | null;
  detail:    string;
  createdAt: Timestamp;
}
