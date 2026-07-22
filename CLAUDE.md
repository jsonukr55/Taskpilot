# TaskPilot — project guide for Claude

## UI work — MANDATORY
Before building or changing **any** UI, read **[docs/UI_GUIDELINES.md](docs/UI_GUIDELINES.md)**
and follow it exactly. It is the single source of truth for spacing, buttons,
forms, cards, dialogs/modals, pickers, icons, colors, and responsiveness.

Non-negotiables:
- Use design tokens (`$space-*`, `$radius-*`, `$font-size-*`) and theme variables
  (`var(--text-secondary)`, `var(--accent-500)`) — **never** raw px or hex in components.
- Reuse global classes/mixins (`.btn-*`, `.form-input`, `.picker`, `card`, `btn-base`,
  `input-base`) instead of inventing new component styles. If a genuinely new shared
  pattern is needed, add it to `src/styles/main.scss` (or a mixin) **and** document it
  in `docs/UI_GUIDELINES.md`.
- Every component SCSS starts with `@use 'variables' as *; @use 'mixins' as *;`.
- Keep changes scoped: prefer component SCSS. Only touch `src/styles/*` when a change
  is intentionally global (and say so).
- Verify new screens at 375 / 768 / 1440px; the page must never scroll horizontally.
- Icons: `<tp-icon name="kebab-name" [size]="N" />` — the name must be registered in
  `src/app/shared/icons.ts` (ng-icons). Entity avatars use an emoji, not an ng-icon.

## Backend & portability — MANDATORY
The plan is **Supabase managed now → self-host on the team's Azure at launch**
(see the `hosting-strategy` memory). So **everything we build must stay
Azure-portable**. Rules:
- Keep the data layer **standard PostgreSQL** — schema, RLS, SQL functions, and
  `client_id` tenancy travel as-is to **Azure Database for PostgreSQL** via `pg_dump`.
  No proprietary/managed-only features that can't be self-hosted.
- **Edge Functions**: put business logic in plain `async` handlers over `supabase-js`
  (runs on Node too). Isolate the runtime glue (`Deno.serve`, `Deno.env`, `jsr:` import)
  so the port to **Azure Functions** is mechanical — see the header of
  `supabase/functions/api/index.ts` for the exact swap points. Don't scatter
  Deno-isms through the logic.
- **Realtime / Auth**: rely on portable concepts (Postgres changefeed, JWT). If a
  feature would lock us to a Supabase-only capability, flag it and prefer the portable
  path (self-hostable GoTrue/Realtime, or Azure AD B2C).
- **Redis / file storage** (upcoming, see docs/BACKLOG.md): choose clients/APIs that
  run identically against a Supabase-hosted and an Azure-hosted instance.
- When adding any backend piece, state briefly how it moves to Azure. If it can't move
  cleanly, don't adopt it without calling that out.

## Stack (quick facts)
- Angular 17 standalone + signals (no NgRx). `computed()`, `effect({allowSignalWrites})`.
- Backend: **Supabase** (Postgres + RLS + Realtime + Auth). Services keep signal APIs;
  realtime pattern = initial fetch + channel that refetches into the same signal.
- Date type across the app is Firestore `Timestamp` (class only, no connection) — mapped
  to/from Postgres `timestamptz` in the service layer (`supabase-map.util.ts`).
- AI features are behind `environment.features.ai` (currently **false** → "Coming soon"),
  proxied through Edge Functions when enabled.
