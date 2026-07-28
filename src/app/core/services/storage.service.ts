import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase.service';

// ============================================================
// StorageService — the ONLY place that talks to Supabase Storage.
// Isolated on purpose: porting to Azure Blob at launch means swapping
// just these three methods (upload / remove / signedUrl) for the Azure
// SDK equivalents; nothing else in the app touches the storage client.
// ============================================================
@Injectable({ providedIn: 'root' })
export class StorageService {
  private readonly supa = inject(SupabaseService);
  private readonly bucket = 'attachments';

  async upload(path: string, file: File): Promise<void> {
    const { error } = await this.supa.client.storage.from(this.bucket)
      .upload(path, file, { upsert: false, contentType: file.type || undefined });
    if (error) throw error;
  }

  async remove(paths: string[]): Promise<void> {
    const { error } = await this.supa.client.storage.from(this.bucket).remove(paths);
    if (error) throw error;
  }

  /** Short-lived signed URL for a private object (view / download). */
  async signedUrl(path: string, expiresInSeconds = 3600): Promise<string> {
    const { data, error } = await this.supa.client.storage.from(this.bucket)
      .createSignedUrl(path, expiresInSeconds);
    if (error || !data) throw error ?? new Error('Could not create a link');
    return data.signedUrl;
  }
}
