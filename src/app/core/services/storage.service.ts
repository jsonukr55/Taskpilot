import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';

// ============================================================
// StorageService — the ONLY place that talks to Supabase Storage.
// Isolated on purpose: porting to Azure Blob at launch means swapping
// just the methods below for the Azure SDK equivalents; nothing else in
// the app touches the storage client.
//
// Two buckets:
//   attachments — private task files, read via short-lived signed URLs.
//   logos       — public entity logos, read via a stable public URL so
//                 lists and the sidebar can render <img> without an async
//                 signing round-trip per row.
// ============================================================

export type Bucket = 'attachments' | 'logos';

@Injectable({ providedIn: 'root' })
export class StorageService {
  private readonly supa = inject(SupabaseService);
  private readonly bucket: Bucket = 'attachments';

  async upload(path: string, file: File): Promise<void> {
    return this.uploadTo(this.bucket, path, file);
  }

  async remove(paths: string[]): Promise<void> {
    return this.removeFrom(this.bucket, paths);
  }

  /** Short-lived signed URL for a private object (view / download). */
  async signedUrl(path: string, expiresInSeconds = 3600): Promise<string> {
    const { data, error } = await this.supa.client.storage.from(this.bucket)
      .createSignedUrl(path, expiresInSeconds);
    if (error || !data) throw error ?? new Error('Could not create a link');
    return data.signedUrl;
  }

  // ---- Bucket-aware variants ----

  async uploadTo(bucket: Bucket, path: string, file: File, upsert = false): Promise<void> {
    const { error } = await this.supa.client.storage.from(bucket)
      .upload(path, file, { upsert, contentType: file.type || undefined });
    if (error) throw error;
  }

  async removeFrom(bucket: Bucket, paths: string[]): Promise<void> {
    const { error } = await this.supa.client.storage.from(bucket).remove(paths);
    if (error) throw error;
  }

  /** Stable public URL — only meaningful for a public bucket ('logos'). */
  publicUrl(bucket: Bucket, path: string): string {
    return this.supa.client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }

  /** Recover the object path from a public URL, so we can delete a replaced logo. */
  pathFromPublicUrl(bucket: Bucket, url: string): string | null {
    const marker = `/storage/v1/object/public/${bucket}/`;
    const at = url.indexOf(marker);
    return at === -1 ? null : decodeURIComponent(url.slice(at + marker.length).split('?')[0]);
  }
}
