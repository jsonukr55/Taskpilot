import { Injectable, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import type { User } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';
import { UserProfile, DEFAULT_PREFERENCES } from '@shared/models/user.model';
import { NoteAccessState } from '@shared/models/note.model';
import { toTs } from './supabase-map.util';

// ============================================================
// AuthService — Supabase Auth (email + Google), Postgres `profiles`.
// The PUBLIC surface (signals + methods) is unchanged from the Firebase
// version so nothing downstream changes; only the internals swapped.
// ============================================================
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly supa   = inject(SupabaseService);
  private readonly router = inject(Router);

  readonly currentUser     = signal<User | null>(null);
  readonly userProfile     = signal<UserProfile | null>(null);
  readonly isLoading       = signal(true);
  readonly isAuthenticated = computed(() => this.currentUser() !== null);
  readonly userId          = computed(() => this.currentUser()?.id ?? null);
  readonly displayName     = computed(() =>
    this.userProfile()?.displayName || metaName(this.currentUser()) || '');
  readonly photoURL        = computed(() =>
    this.userProfile()?.photoURL ?? metaPhoto(this.currentUser()));
  readonly isAdmin         = computed(() => this.userProfile()?.globalRole === 'admin');

  // Resolves after the first auth-state resolution (guards await this).
  private _resolveInit!: () => void;
  readonly initialized = new Promise<void>(r => { this._resolveInit = r; });

  constructor() {
    // Fires INITIAL_SESSION on load (from stored session / OAuth redirect),
    // then on every sign-in / sign-out / token refresh.
    this.supa.auth.onAuthStateChange((_event, session) => {
      void this.handleSession(session?.user ?? null);
    });
  }

  private async handleSession(user: User | null): Promise<void> {
    this.currentUser.set(user);
    if (user) await this.loadOrCreateProfile(user);
    else this.userProfile.set(null);
    this.isLoading.set(false);
    this._resolveInit();
  }

  /** Supabase session access token (replaces the old getIdToken()). */
  async getAccessToken(): Promise<string | null> {
    const { data } = await this.supa.auth.getSession();
    return data.session?.access_token ?? null;
  }

  // ---- Sign-in ----

  private postAuthTarget(): string {
    const returnUrl = this.router.parseUrl(this.router.url).queryParams['returnUrl'];
    return returnUrl && typeof returnUrl === 'string' ? returnUrl : '/dashboard';
  }

  async signInWithGoogle(): Promise<void> {
    // OAuth redirects the browser to Google and back to redirectTo, where
    // detectSessionInUrl completes the session and onAuthStateChange fires.
    const target = this.postAuthTarget();
    const { error } = await this.supa.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}${target}` },
    });
    if (error) throw error;
  }

  async signUpWithEmail(name: string, email: string, password: string): Promise<void> {
    const { error } = await this.supa.auth.signUp({
      email, password,
      options: { data: { displayName: name } },
    });
    if (error) throw error;
    // Profile is created lazily on the SIGNED_IN event. (Requires email
    // confirmation to be OFF in Supabase Auth settings for immediate login.)
    await this.router.navigateByUrl(this.postAuthTarget());
  }

  async signInWithEmail(email: string, password: string): Promise<void> {
    const { error } = await this.supa.auth.signInWithPassword({ email, password });
    if (error) throw error;
    await this.router.navigateByUrl(this.postAuthTarget());
  }

  async signOut(): Promise<void> {
    await this.supa.auth.signOut();
    this.userProfile.set(null);
    this.currentUser.set(null);
    await this.router.navigate(['/auth/login']);
  }

  // ---- Profile ----

  private async loadOrCreateProfile(user: User): Promise<void> {
    try {
      const { data, error } = await this.supa.db('profiles').select('*').eq('id', user.id).maybeSingle();
      if (error) throw error;
      if (data) { this.userProfile.set(rowToProfile(data)); return; }
      await this.createProfile(user);
    } catch {
      // In-memory fallback so the app still renders if the profile read fails.
      this.userProfile.set({
        uid: user.id, email: user.email ?? '', displayName: metaName(user) || 'User',
        photoURL: metaPhoto(user), preferences: DEFAULT_PREFERENCES,
        stats: { totalTasks: 0, completedTasks: 0, totalCategories: 0, currentStreak: 0, longestStreak: 0, lastActiveDate: null },
        calendarIntegrations: [], seenInsightIds: [], createdAt: null as any, updatedAt: null as any,
      });
    }
  }

  async createProfile(user: User): Promise<void> {
    const row = {
      id: user.id,
      email: user.email ?? '',
      display_name: metaName(user) || 'User',
      photo_url: metaPhoto(user),
      preferences: DEFAULT_PREFERENCES,
      stats: { totalTasks: 0, completedTasks: 0, totalCategories: 0, currentStreak: 0, longestStreak: 0, lastActiveDate: null },
      calendar_integrations: [],
      seen_insight_ids: [],
    };
    const { data, error } = await this.supa.db('profiles').upsert(row, { onConflict: 'id' }).select('*').single();
    if (error) throw error;
    this.userProfile.set(rowToProfile(data));
  }

  /** Re-read the profile (e.g. after a server-side role change). */
  async reloadProfile(): Promise<void> {
    const uid = this.userId();
    if (!uid) return;
    const { data } = await this.supa.db('profiles').select('*').eq('id', uid).maybeSingle();
    if (data) this.userProfile.set(rowToProfile(data));
  }

  async updatePreferences(prefs: Partial<UserProfile['preferences']>): Promise<void> {
    const uid = this.userId();
    if (!uid) return;
    const merged = { ...this.userProfile()?.preferences, ...prefs };
    await this.supa.db('profiles').update({ preferences: merged }).eq('id', uid);
    this.userProfile.update(p => p ? { ...p, preferences: { ...p.preferences, ...prefs } } : null);
  }

  async updateNoteAccess(access: NoteAccessState): Promise<void> {
    const uid = this.userId();
    if (!uid) return;
    await this.supa.db('profiles').update({ note_access: access }).eq('id', uid);
    this.userProfile.update(p => p ? { ...p, noteAccess: access } : null);
  }
}

// ---- Mapping + metadata helpers ----

function rowToProfile(row: any): UserProfile {
  return {
    uid:         row.id,
    email:       row.email,
    displayName: row.display_name,
    photoURL:    row.photo_url ?? null,
    globalRole:  row.global_role ?? undefined,
    preferences: row.preferences ?? DEFAULT_PREFERENCES,
    stats:       row.stats ?? { totalTasks: 0, completedTasks: 0, totalCategories: 0, currentStreak: 0, longestStreak: 0, lastActiveDate: null },
    calendarIntegrations: row.calendar_integrations ?? [],
    seenInsightIds: row.seen_insight_ids ?? [],
    noteAccess:  row.note_access ?? undefined,
    createdAt:   toTs(row.created_at) as any,
    updatedAt:   toTs(row.updated_at) as any,
  };
}

function metaName(user: User | null): string {
  const m = user?.user_metadata ?? {};
  return (m['displayName'] || m['full_name'] || m['name'] || user?.email || '') as string;
}
function metaPhoto(user: User | null): string | null {
  const m = user?.user_metadata ?? {};
  return (m['avatar_url'] || m['picture'] || null) as string | null;
}
