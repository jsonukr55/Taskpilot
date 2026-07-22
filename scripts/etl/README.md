# TaskPilot ETL — Firestore → Supabase

Migrates **Google-authenticated users only** and **all of their data** from the
Firebase project into Supabase Postgres. Firebase uids are remapped to new
Supabase Auth uuids and every reference is rewritten. Idempotent (re-runnable).

## What you need to provide (never commit these)

1. **Firebase service-account JSON**
   Firebase Console → ⚙ Project settings → *Service accounts* → **Generate new private key**.
   Save it as: `s:\P\TaskPilot\.secrets\firebase-admin.json`

2. **Supabase service_role key**
   Supabase Dashboard → *Project Settings → API* → **service_role** (secret).

Both paths are git-ignored (`.secrets/`, `scripts/etl/.env`).

## Run

```bash
# from the repo root
npm i firebase-admin            # one-time (dev dependency for the ETL only)

# provide the Supabase creds (PowerShell)
$env:SUPABASE_URL="https://uffyycxwhldjqikcmopu.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="<paste service_role key>"

# dry run first — reads Firestore, writes nothing, prints counts
$env:DRY_RUN="1"; node scripts/etl/migrate.mjs

# then the real thing
$env:DRY_RUN="0"; node scripts/etl/migrate.mjs
```

(Default service-account path is `.secrets/firebase-admin.json`; override with
`FIREBASE_SA_PATH`.)

## What it moves

profiles · categories · groups (+members, +notes, +comments) · organizations
(+members) · spaces (+members) · tasks (+subtasks) · personal notes (+comments)
· daily reports (+entries) · schedules · insights · invites · org invites · settings

## Notes

- **Only Google users** are imported; email/password accounts are skipped (their
  Firebase scrypt password hashes can't move to Supabase). They keep signing in
  with Google — same email → same account.
- Organizations import with `client_id = null` (Firestore had no client layer).
  Assign them to a Client afterwards from the Admin panel.
- Rows whose owner wasn't migrated (e.g. a group owned by a skipped user) are
  skipped to keep foreign keys valid.
- Safe to re-run: everything is an upsert keyed on the original ids.
