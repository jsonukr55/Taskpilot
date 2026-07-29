import { Injectable, inject } from '@angular/core';
import { StorageService } from './storage.service';
import { nanoid } from '@shared/utils/id.util';

// ============================================================
// LogoService — uploads/removes the image logo of an entity.
//
// Objects go to the public "logos" bucket at {kind}/{entityId}/{id}.{ext}.
// The first two path segments are what the storage RLS policy reads to
// decide whether the caller may write (see 0025_entity_logos.sql), so the
// layout is load-bearing — don't flatten it.
//
// Kinds are the literal table names on purpose: the SQL side switches on
// the same string, so there's one vocabulary rather than a mapping table.
// ============================================================

export type LogoKind = 'clients' | 'organizations' | 'spaces' | 'groups' | 'categories';

const MAX_BYTES = 2 * 1024 * 1024;   // keep in sync with the bucket's file_size_limit
const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];

const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/svg+xml': 'svg',
};

@Injectable({ providedIn: 'root' })
export class LogoService {
  private readonly storage = inject(StorageService);

  readonly accept = ALLOWED.join(',');
  readonly maxBytes = MAX_BYTES;

  /** Human-readable rejection reason, or null when the file is acceptable. */
  validate(file: File): string | null {
    if (!ALLOWED.includes(file.type)) return 'Use a PNG, JPG, WEBP, GIF or SVG image.';
    if (file.size > MAX_BYTES) return `That image is ${Math.round(file.size / 1024)} KB — the limit is 2 MB.`;
    return null;
  }

  /** Upload and return the public URL to store in the entity's `iconUrl`. */
  async upload(kind: LogoKind, entityId: string, file: File): Promise<string> {
    const reason = this.validate(file);
    if (reason) throw new Error(reason);

    const path = `${kind}/${entityId}/${nanoid(12)}.${EXT[file.type] ?? 'png'}`;
    await this.storage.uploadTo('logos', path, file);
    return this.storage.publicUrl('logos', path);
  }

  /** Best-effort delete of a previously uploaded logo; never throws. */
  async remove(url: string | null | undefined): Promise<void> {
    if (!url) return;
    const path = this.storage.pathFromPublicUrl('logos', url);
    if (!path) return;
    await this.storage.removeFrom('logos', [path]).catch(() => { /* orphan object is harmless */ });
  }
}
