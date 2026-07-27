import { Timestamp } from '@angular/fire/firestore';

// ============================================================
// In-app notification — a per-recipient feed entry. Created
// server-side (e.g. when a task is assigned to the user).
// ============================================================

export type NotificationType = 'task_assigned';

export interface AppNotification {
  id:        string;
  userId:    string;   // recipient
  actorId:   string | null;
  type:      NotificationType | string;
  taskId:    string | null;
  title:     string;
  body:      string;
  read:      boolean;
  createdAt: Timestamp;
}
