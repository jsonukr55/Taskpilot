import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { environment } from '@env/environment';
import { AuthService } from './auth.service';

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

  /** Promote (role='admin') or demote (role=null) a user by email. */
  async setGlobalRole(email: string, role: 'admin' | null): Promise<{ uid: string; email: string; role: 'admin' | null }> {
    const idToken = await this.auth.currentUser()?.getIdToken();
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
