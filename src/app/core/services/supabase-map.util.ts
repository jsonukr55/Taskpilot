import { Timestamp } from '@angular/fire/firestore';

// ============================================================
// Supabase ↔ model mapping helpers.
// We keep the Firestore `Timestamp` class as the app's date type (it's a
// plain class, no Firestore connection needed), so every existing
// `.toDate()` / `.seconds` / `.toMillis()` call site keeps working. The
// only job here is converting Postgres `timestamptz` (returned as ISO
// strings by supabase-js) to/from that Timestamp.
// ============================================================

/** Postgres timestamptz (ISO string) → Timestamp (or null). */
export function toTs(iso: string | null | undefined): Timestamp | null {
  return iso ? Timestamp.fromDate(new Date(iso)) : null;
}

/** Timestamp | Date | ISO string | null → ISO string for Postgres (or null). */
export function fromTs(ts: Timestamp | Date | string | null | undefined): string | null {
  if (ts == null) return null;
  if (typeof ts === 'string') return ts;
  if (ts instanceof Date) return ts.toISOString();
  return ts.toDate().toISOString();   // Firestore Timestamp
}

/** Current time as an ISO string (replaces serverTimestamp() for client writes). */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Update patch for the entity avatar fields shared by client / org / space /
 * group. Every other key on those tables is already snake_case-identical to
 * the model, so `iconUrl` -> `icon_url` is the only rename needed — and it
 * must survive an explicit `null` (clearing an uploaded logo), which is why
 * this tests `!== undefined` rather than truthiness.
 */
export function entityIconPatch<T extends { iconUrl?: string | null }>(
  changes: T,
): Record<string, unknown> {
  const { iconUrl, ...rest } = changes;
  const patch: Record<string, unknown> = { ...rest };
  if (iconUrl !== undefined) patch['icon_url'] = iconUrl;
  return patch;
}
