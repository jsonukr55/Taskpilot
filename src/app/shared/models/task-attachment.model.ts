import { Timestamp } from '@angular/fire/firestore';

// ============================================================
// Task attachment — a file uploaded against a task. The binary lives in
// the "attachments" storage bucket at `path`; this is the metadata.
// ============================================================

export interface TaskAttachment {
  id:           string;
  taskId:       string;
  name:         string;
  mime:         string | null;
  size:         number;         // bytes
  path:         string;         // object path within the bucket
  uploaderId:   string | null;
  uploaderName: string | null;
  createdAt:    Timestamp;
}

/** Allowed upload extensions (video, pdf, zip, images + common docs). */
export const ALLOWED_EXTENSIONS = [
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp',
  'mp4', 'mov', 'webm', 'avi', 'mkv',
  'pdf', 'zip',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv', 'md', 'json',
];

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;   // 25 MB (bucket also enforces)

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

export function isImage(a: TaskAttachment): boolean {
  return (a.mime ?? '').startsWith('image/');
}

/** Human-readable size, e.g. "2.4 MB". */
export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${units[i]}`;
}
