import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '@env/environment';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

export interface AdminUser {
  id: string; email: string; displayName: string; photoURL: string | null; globalRole: 'admin' | null;
}
export interface TaskLite {
  id: string; title: string; status: string; stage: string; parentId: string | null;
  spaceId: string | null; orgId: string | null; clientId: string | null; updatedAt: string | null;
}
export interface SpaceLite { id: string; clientId: string | null; orgId: string; }

// ============================================================
// AdminService — global-admin operations (promote/demote admins).
// The only op is setGlobalRole, which must run server-side (the
// users/{uid} rule is self-only, so a client can't write another
// user's role). The Cloud Function also allows a hardcoded bootstrap
// email to self-promote the very first admin.
// ============================================================

@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly supa = inject(SupabaseService);

  // ---- Platform-wide reads (RLS-gated to global admins) ----

  async allUsers(): Promise<AdminUser[]> {
    const { data, error } = await this.supa.db('profiles')
      .select('id,email,display_name,photo_url,global_role').order('display_name');
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id, email: r.email, displayName: r.display_name, photoURL: r.photo_url ?? null, globalRole: r.global_role ?? null,
    }));
  }

  async allTasks(): Promise<TaskLite[]> {
    const { data, error } = await this.supa.db('tasks')
      .select('id,title,status,stage,parent_id,space_id,org_id,client_id,updated_at')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r: any) => ({
      id: r.id, title: r.title, status: r.status, stage: r.stage, parentId: r.parent_id ?? null,
      spaceId: r.space_id ?? null, orgId: r.org_id ?? null, clientId: r.client_id ?? null, updatedAt: r.updated_at ?? null,
    }));
  }

  async allSpaces(): Promise<SpaceLite[]> {
    const { data, error } = await this.supa.db('spaces').select('id,client_id,org_id');
    if (error) throw error;
    return (data ?? []).map((r: any) => ({ id: r.id, clientId: r.client_id ?? null, orgId: r.org_id }));
  }

  async allAttachments(): Promise<{ clientId: string | null; size: number }[]> {
    const { data, error } = await this.supa.db('task_attachments').select('client_id,size');
    if (error) throw error;
    return (data ?? []).map((r: any) => ({ clientId: r.client_id ?? null, size: Number(r.size ?? 0) }));
  }

  /** Promote (role='admin') or demote (role=null) a user by email. */
  async setGlobalRole(email: string, role: 'admin' | null): Promise<{ uid: string; email: string; role: 'admin' | null }> {
    const idToken = await this.auth.getAccessToken();
    if (!idToken) throw new Error('Not authenticated');
    return firstValueFrom(this.http.post<{ uid: string; email: string; role: 'admin' | null }>(
      `${environment.functionsBaseUrl}/setGlobalRole`,
      { email: email.trim(), role },
      { headers: { Authorization: `Bearer ${idToken}` } }
    ));
  }

  /** Self-promote the first admin (only works for a bootstrap email). */
  async claimBootstrapAdmin(): Promise<{ uid: string; email: string; role: 'admin' | null }> {
    const email = this.auth.currentUser()?.email;
    if (!email) throw new Error('Not authenticated');
    return this.setGlobalRole(email, 'admin');
  }
}
