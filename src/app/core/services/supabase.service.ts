import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '@env/environment';

// ============================================================
// SupabaseService — single shared Supabase client for the app.
// Wraps auth + the Postgres/Realtime data client. Every migrated
// service reaches the DB through `db` (a PostgREST query builder) and
// opens realtime channels through `channel()`. RLS enforces access, so
// the anon key shipped in the client is safe.
// ============================================================
@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly client: SupabaseClient = createClient(
    environment.supabase.url,
    environment.supabase.anonKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,   // completes OAuth (Google) redirects
      },
    }
  );

  /** Query builder for a table (PostgREST). */
  db<T = any>(table: string) {
    return this.client.from(table);
  }

  /** Auth namespace (signIn / signUp / OAuth / session). */
  get auth() {
    return this.client.auth;
  }

  /** Call a Postgres function (RPC), e.g. invite previews. */
  rpc<T = any>(fn: string, args?: Record<string, unknown>) {
    return this.client.rpc(fn, args);
  }
}
