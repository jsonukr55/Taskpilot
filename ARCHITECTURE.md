# TaskPilot — Architecture & Flow

A deep, "every nook and cranny" walkthrough of how TaskPilot is built and how data
flows through it.

---

## 1. What it is / tech stack

TaskPilot is an **AI-powered task-management + collaboration app**: tasks,
Notion-style notes, collaborative groups, a team daily-report (standup) tool,
calendar, analytics, and an AI assistant.

| Layer | Tech |
|-------|------|
| Frontend | **Angular 17** (standalone components, **signals**-first, no NgRx), SCSS design system |
| Realtime DB | **Cloud Firestore** (`@angular/fire`) |
| Auth | **Firebase Auth** (Google + email/password) |
| Backend | **Cloud Functions** (Node 20, Gen-1 HTTPS) — a thin AI proxy + a few server-only ops |
| AI | **Groq** LLMs (llama-3.3-70b text, llama-4-scout vision), called **only** from Functions |
| Hosting | **Firebase Hosting** (`dist/taskpilot/browser`) |
| Mobile shell | **Capacitor 6** (Android/iOS wrappers configured) |

**Architectural shape:** a **client-heavy SPA + Firebase BaaS**. Almost all logic
lives in the browser talking directly to Firestore; Cloud Functions exist only for
(a) keeping the Groq API key server-side, and (b) operations a client can't do
securely (redeeming group invites, writing insights). There is **no custom app
server**.

---

## 2. Bootstrap & providers (`src/app/app.config.ts`)

`bootstrapApplication(AppComponent, appConfig)` with these providers:

- `provideZoneChangeDetection({ eventCoalescing: true })` — still zone-based CD (so
  plain method calls in templates re-evaluate each tick), tuned to coalesce events.
- `provideRouter(routes, withViewTransitions(), withComponentInputBinding())`
  - **`withComponentInputBinding()`** is important: route params/query become
    component `input()`s (e.g. `NoteEditorComponent.noteId`, `JoinGroupComponent.token`).
- `provideHttpClient(withInterceptorsFromDi())` — for AI Functions calls + external calendars.
- `provideAnimationsAsync()`.
- `provideFirebaseApp / provideAuth / provideFirestore` — Firebase wired from
  `environment.firebase`.

Path aliases (tsconfig): `@core/*`, `@shared/*`, `@env/*`.

---

## 3. Routing & guards (`app.routes.ts`, `core/guards/auth.guard.ts`)

Two top-level branches, everything lazy-loaded:

```
/auth        → publicGuard  → login
/            → authGuard    → ShellComponent (layout)
                 ├ dashboard (default)     ├ notes, notes/:noteId
                 ├ tasks, tasks/:id        ├ groups, groups/:groupId
                 ├ daily                   ├ groups/:groupId/notes/:noteId
                 ├ calendar                ├ join/:token
                 ├ categories              ├ ai-chat, analytics
**              → redirect /dashboard
```

- **`authGuard`** awaits `auth.initialized` (a promise resolved after the first
  `onAuthStateChanged` + profile load), then allows or redirects to
  `/auth/login?returnUrl=<attempted-url>`.
- **`publicGuard`** is the inverse (signed-in users bounced to `/dashboard`).
- The **`returnUrl`** round-trips through login so an invite link
  (`/join/:token`) survives a logged-out visitor signing in.

---

## 4. The Shell (`layout/shell`)

`ShellComponent` is the authenticated frame: sidebar + topbar + `<router-outlet>`
+ a single `<tp-toast/>`. Its **critical job** is owning the lifecycle of the
global realtime listeners:

```ts
ngOnInit()  → tasks.startListening() + categories.startListening()
              + scheduling.startListening() + groups.startListening()
ngOnDestroy → the matching stopListening() for each
```

So the moment you're authenticated, task/category/schedule/group data streams into
signals and stays live app-wide. Feature pages open **their own** scoped listeners
on top (a group's notes, a note's comments, etc.).

---

## 5. State-management philosophy

**No NgRx / no RxJS store.** The pattern everywhere:

```
Firestore onSnapshot(query)  →  service signal.set(rows)  →  computed() derivations  →  template
mutations: addDoc/updateDoc/deleteDoc  →  (listener echoes the change back)  →  UI updates
```

- Services are `providedIn: 'root'` singletons holding `signal<T[]>` state.
- Derived state is `computed()`; templates read signals/computed.
- Writes are **optimistic-free** — the UI updates when the Firestore listener
  echoes the write back (usually <500 ms). This keeps a single source of truth.
- Listener lifecycle: `startListening()` stores an `unsubscribe` fn; `stopListening()`
  calls it. Feature-scoped listeners follow the same open/close idiom.

---

## 6. Auth flow (`core/services/auth.service.ts`, `shared/models/user.model.ts`)

- Signals: `currentUser` (Firebase `User`), `userProfile` (Firestore
  `users/{uid}` doc), `isAuthenticated`, `userId`, `displayName`, `photoURL`.
- `onAuthStateChanged` → `loadOrCreateProfile(user)`: reads `users/{uid}`; if
  missing, seeds a default `UserProfile` (preferences, stats, calendar
  integrations, seenInsightIds). Resolves the `initialized` promise used by guards.
- Sign-in methods (`signInWithGoogle`, `signUpWithEmail`, `signInWithEmail`) then
  navigate to `postAuthTarget()` = the `returnUrl` query param, else `/dashboard`.
- `updatePreferences()` merge-writes `users/{uid}.preferences` (theme, timezone,
  accent, working hours, etc.).

**`UserProfile`** = uid, email, displayName, photoURL, `preferences`
(theme/timezone/weekStart/defaultView/workingHours/…), `stats`
(totals/streaks), `calendarIntegrations[]`, `seenInsightIds[]`, timestamps.

---

## 7. Data layer — Firestore collections

| Collection | Scope | Shape / notes |
|-----------|-------|---------------|
| `users/{uid}` | owner only | `UserProfile` |
| `tasks/{id}` | `userId` OR group members | `Task` (see below). `parentId` = subtask, `groupId`/`assigneeIds` = shared |
| `categories/{id}` | `userId` | icon/color/keywords/rules/order; seeded with defaults for new users |
| `schedules/{id}` | `userId` | `ScheduledBlock` time-blocks (auto/AI scheduling) |
| `insights/{id}` | `userId`, **Functions-write-only** | AI productivity insights (7-day TTL) |
| `notes/{id}` | owner (`ownerId`) | **personal** notes |
| `notes/{id}/comments/{id}` | note owner | personal note comments |
| `groups/{id}` | membership maps | `Group` (see Groups) |
| `groups/{gid}/notes/{id}` | group members | **group** notes |
| `groups/{gid}/notes/{id}/comments/{id}` | group members | anchored comments |
| `invites/{token}` | doc id **is** the secret | group invite links |
| `dailyReports/{id}` + `/entries` | team | standup report (see Daily Report) |
| `settings/workingCalendar` | read-only | holidays/weekends/timezone override |
| `usage/{id}` | Functions-write | AI usage log |

### The `Task` model (`shared/models/task.model.ts`)
Core (`title/description/status/priority`), dates (`startDate/dueDate/dueTime/completedAt`),
effort (`estimatedHours/actualHours`), hierarchy (`parentId`), organization
(`categoryIds[]/tags[]/checklist[]`), scheduling (`timeBlocks[]/recurrence/isScheduled`),
AI (`aiMetadata`), attachments (`imageUrl`), reminders, timestamps, and the
collaboration fields **`groupId?`** (null = personal) + **`assigneeIds?`**.

---

## 8. Services (core logic)

- **`TaskService`** — the workhorse. `onSnapshot(tasks where userId==uid)` → `tasks`
  signal; `filteredTasks` computed applies filter/sort/search and **excludes
  subtasks** (`!parentId`). CRUD + `bulkUpdateStatus/bulkDelete` (batched),
  checklist ops, `createSubtask(parentId,title)`, `createGroupTask`, `setAssignees`,
  and a **separate** `groupTasks` listener (`where groupId==gid`) for the group page.
- **`CategoryService`** — user-scoped categories; **seeds defaults** on first empty
  snapshot; `detectCategory(text)` keyword matcher for AI auto-categorization;
  cascade-deletes category refs from tasks via a batch.
- **`SchedulingService`** — time-blocks; free-slot detection, conflict detection,
  auto-schedule a task into working hours, AI schedule suggestions.
- **`NoteService`** — dual-mode: group notes (`groups/{gid}/notes`) **or** personal
  notes (top-level `notes`) selected by a `groupId: string | null` param and small
  path helpers. Streams a group/personal **notes list**, plus the **active note**
  and its **comments** for the editor. **Debounced block saves** (~350 ms),
  `flush/flushAll`, and a recursive **`stripUndefined()`** on every write (Firestore
  rejects `undefined`; non-todo blocks legitimately omit `checked`).
- **`GroupService`** — `onSnapshot(groups where memberIds array-contains uid)`;
  create/rename/delete groups; member management; **invite create/list/revoke**;
  `previewInvite` (single `getDoc` by token) and `joinByToken` (calls the Cloud
  Function with a Bearer ID token).
- **`SearchService`** — global search. Tasks match instantly from memory; after a
  **2 s debounce** it `getDocs` personal notes (`where ownerId==uid`) + each group's
  notes subcollection, filters by title+block text, and exposes sectioned results.
  A `seq` counter drops out-of-order async results.
- **`AiService`** — thin client for the Functions proxy. Every method POSTs to
  `${functionsBaseUrl}/<fn>` with `Authorization: Bearer <idToken>`
  (extractTasks, extractTasksFromImage, chat, generateInsights, suggestSchedule,
  transformText). **No API key in the browser.**
- **`ThemeService`** — dark/light/`system` + a runtime **accent color** (12
  ClickUp-style presets). Writes CSS custom properties (`--accent-500`, `--accent-rgb`,
  …) so the whole design system re-tints live; persisted in user preferences.
- **`ToastService`** — signal queue of transient toasts (`success/error/info`),
  auto-dismiss; rendered once by `<tp-toast/>` in the shell.
- **`CalendarService`** — Google Calendar + Microsoft Graph integration via raw
  `HttpClient` (OAuth access tokens), normalized to a `CalendarEvent` shape.
- **`WorkingCalendarService`** — the "what day is it" engine. Dates are
  `'YYYY-MM-DD'` strings anchored to **IST (Asia/Kolkata)** via `Intl`, with weekday
  math done on the string as a UTC calendar date to avoid timezone drift. Weekends +
  mandatory holidays define working days; overridable by `settings/workingCalendar`.
- **`DailyReportService`** — one team's standup for the current working day: listens
  to the report doc + `entries` subcollection, computes a structured `reportView`,
  and derives **live Teams-paste text + rich HTML** for the clipboard.

---

## 9. Security model (`firestore.rules`)

The rules flipped from single-user to **membership-based**, with existence guards
so pre-existing personal data keeps working. Key helpers:

```
groupData(g)  = get(/groups/$(g)).data
isMember(g)   = auth.uid in groupData(g).memberIds
canEditGroup(g) = isMember(g) && groupData(g).roles[auth.uid] in ['owner','editor']
```

- **users / categories / schedules** — strictly `resource.data.userId == auth.uid`.
- **insights** — read own; **write denied** (only Functions write via admin SDK).
- **tasks** — read/write if you own it (`userId`) **or** it's a group task and you're
  a member/editor. Guarded with `('groupId' in resource.data)` so old personal tasks
  (no `groupId`) evaluate correctly.
- **notes (personal)** — `resource.data.ownerId == auth.uid`; comments gated by the
  parent note's owner.
- **groups** — read if member; create if you're the `ownerId` and in `memberIds`;
  update/delete owner-only (member joins happen server-side).
  - **groups/notes** — members read; editors/owner write.
  - **notes/comments** — any member creates; author or owner edits/deletes.
- **invites** — `get` allowed for any signed-in user (preview by secret token);
  `list` restricted to group editors (prevents token enumeration); create/revoke =
  group editors.

**Why membership is stored as maps + an array:** a group holds
`memberIds: string[]` (for `array-contains` queries **and** the rules read gate),
`roles: {uid: role}` (rules write gate via `roles[uid] in [...]`), and
`memberProfiles: {uid: {displayName, photoURL}}` (UI). You can't index an
array-of-objects in rules, so this trio is the workable pattern.

---

## 10. Cloud Functions (`functions/src/index.ts`)

Gen-1 HTTPS functions, each: CORS → `OPTIONS` short-circuit → `verifyToken()`
(Bearer Firebase ID token) → Groq call → JSON. The Groq key comes from
**`functions/.env` → `process.env.GROQ_API_KEY`** (git-ignored).

| Function | Purpose |
|----------|---------|
| `extractTasks` | text → structured tasks |
| `extractTasksFromImage` | vision model → tasks from a photo |
| `chat` | conversational assistant → `{message, intents[]}` (create/move/complete/…); the frontend executes intents |
| `generateInsights` | productivity stats → insights; also writes `insights/*` (admin) |
| `suggestSchedule` | tasks + free slots → schedule suggestions |
| `transformText` | notes AI "skills" (improve/fix/shorten/…) → text |
| `joinGroup` | **the one that can't be client-side**: verifies invite token in a transaction (not revoked/expired/maxUses), adds caller to `memberIds/roles/memberProfiles`, bumps `useCount` |
| `cleanupExpiredInsights` | scheduled (24h) TTL cleanup |

> Cloud Functions require the **Blaze** plan. See `DEPLOYMENT.md`.

---

## 11. Feature deep-dives

### Tasks (`features/tasks`, `shared/components/task-card`, `task-drawer`)
- **List/Board** grouped by status (`statusGroups` computed); board is the same data
  in columns. `task-card` rows show a **subtask count** and a hover **"+" add-subtask**
  that opens an **inline input** in the list; nested subtasks render indented.
- **Task drawer** (from a list click): edits autosave (debounced `flushSave`). **Key
  fix:** the drawer's `task` input is a static snapshot, so it reads **live** data via
  `live = computed(() => taskService.getTaskById(task().id))` for checklist/subtasks —
  otherwise added items were saved but not shown until reload.
- **Est. hours** auto-sum: if any subtask has hours, the parent shows the sum
  (read-only "auto from subtasks"); else it's a manual field.
- **Create modal** — 4 modes: **AI text**, **image**, **file import** (JSON/CSV
  parsed client-side), and **Manual** form (+ a **subtasks** draft list created under
  the new task). Saves now surface errors in a red banner instead of failing silently.

### Notes editor (`features/notes/note-editor`) — the most complex piece
- **Block model:** a note is `blocks: NoteBlock[]`, each `{id, type, html, checked?,
  indent?, assignees?, date?}`. Types: paragraph, h1–h3, bulleted, numbered, todo,
  quote, callout, divider. `html` holds inline formatting.
- **`EditableBlockDirective`** bridges each `contentEditable` line to the model
  **without clobbering the caret**: it writes model→DOM only when the element is
  **not focused** (so remote updates repaint idle lines), and emits DOM→model on input.
- **Live collaboration reconcile** (`effect`): remote note → `localBlocks`, but the
  block you're **actively typing in** (within a 1.5 s grace window) keeps your local
  text; an **idle** focused line accepts a peer's edit (it blurs to force a repaint).
  Last-write-wins per block (no CRDT).
- **Menus:** `/` **slash menu** (insert block type), a **selection bubble menu**
  (bold/italic/underline/strike/code/link, Turn-into **hover submenu**, Comment, and
  **AI skills**), and the left-gutter **`+` / `⋮⋮`** (⋮⋮ = **CDK drag handle** to
  reorder + click for the block menu).
- **Nesting:** Tab/Shift+Tab change `indent`; bullets rotate `•→◦→▪`; numbered lists
  renumber per indent level.
- **Per-line extras:** comments (anchored to `blockId`), assignment with
  **viewer/editor** access role (a per-line viewer can't edit that line), and a **date**
  picker.
- **Undo/redo:** an in-component history stack (Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z + toolbar
  buttons), coalescing rapid typing; structural edits are discrete steps.
- **Copy note:** serializes to **rich HTML + Markdown** (`ClipboardItem`) preserving
  headings/lists/todos/quotes.
- **Personal vs group:** the same editor is reused; an empty `groupId` input = personal
  mode (no members → assignment hidden; canEdit = true; back link → `/notes`).

### Groups (`features/groups`)
- **Groups list**, **group detail** (members + role dropdowns, invite generation with
  role, notes list, group tasks with assignment, owner settings/delete), and
  **join** page. Invite link = `/join/<token>`; redemption calls the `joinGroup`
  function; a logged-out invitee is carried back via `returnUrl`.

### Daily Report (`features/daily-report`)
- A **team standup** tool: each member fills their "did today / plan tomorrow"
  entry; the service composes a structured, ordered report anchored to the **IST
  working day** (skips weekends/holidays) and produces **one-click Teams-paste**
  text/HTML. Manager can lock the report.

### Calendar (`features/calendar`)
- Week time-grid (7 days × hours). Renders scheduled blocks + task due/start pills,
  a "now" line, plus an **all-day notes band** showing personal notes on the day they
  were created (hover → preview popover). Optional Google/Microsoft external events.

### Dashboard / Analytics / Categories / AI Chat
- **Dashboard:** greeting, stat cards, **AI insights**, due-today, and quick actions
  (New Task / **New Note** / **New Group** / Ask-AI).
- **Analytics:** completion trends, category breakdowns.
- **Categories:** CRUD grid with icon/color/keyword rules.
- **AI Chat:** conversational task ops; the assistant returns `intents` the component
  executes against `TaskService`/`CategoryService`. (Currently surfaced as
  **"coming soon"** in the nav/topbar.)

---

## 12. Theming & design system (`src/styles`)

- `_variables.scss` — palette, spacing/radii/shadows/transitions, breakpoints, and
  the **CSS custom properties** for light + `[data-theme='dark']` (backgrounds,
  text, borders, surfaces). `ThemeService` injects a live **accent** on top
  (`--accent-500`, `--accent-rgb`).
- `_mixins.scss` — `flex-*`, `card`, `btn-base`, `input-base`, `text-truncate/clamp`,
  `glass`, `custom-scrollbar`, `gradient-text`, responsive `sm/md/lg/xl`.
- `main.scss` — global classes reused everywhere: `.btn*`, `.form-*`, `.card`,
  `.badge`, `.avatar(+stack)`, `.modal(-backdrop)`, `.picker`, animations, tooltip.
- Components are **standalone** with `tp-` selectors, `styleUrl` SCSS that
  `@use 'variables'/'mixins'`, and template control-flow (`@if/@for/@switch`).

---

## 13. Build & deploy

- Dev: `npm start` (or `ng serve --port <n>`), watch-mode HMR.
- Prod: `npm run build:prod` → `dist/taskpilot/browser`; functions `tsc` → `lib`.
- Deploy targets: `hosting`, `functions`, `firestore:rules`, `firestore:indexes`
  to project **`taskpilot-ad725`** (live at `taskpilot-ad725.web.app`). Full steps
  in **`DEPLOYMENT.md`**.

---

## 14. The "nooks & crannies" (non-obvious logic worth knowing)

- **Firestore hates `undefined`** → `NoteService.stripUndefined()` on every note
  write; the original bug was `checked: undefined` on non-todo blocks.
- **Stale-snapshot drawer** → task drawer reads `live()` from the service, not its
  frozen `task` input, so checklist/subtasks reflect instantly.
- **Focused-block skip** in the notes reconcile is **time-boxed** (1.5 s) so an idle
  cursor doesn't block a teammate's edit forever.
- **Membership as maps + array** because Firestore rules can't index arrays of
  objects; joins go through the `joinGroup` **function** because a non-owner can't
  self-add under the rules.
- **Invite `get` vs `list`** split prevents token enumeration while allowing preview.
- **Secret hygiene:** the Groq key lives only in `functions/.env` (git-ignored). A
  frontend key would be in the bundle *and* blocked by GitHub push protection — hence
  the whole AI-via-Functions proxy.
- **IST-anchored dates** in the working calendar avoid the classic
  "date shifts by a day" timezone bug by treating `YYYY-MM-DD` as a UTC calendar date.
- **`withComponentInputBinding()`** is why route params arrive as `input()`s.
- **CD reliance:** because it's zone-based, plain template method calls (e.g.
  `subtasksOf()`, `numberFor()`) re-evaluate each tick — cheap here, but the reason
  they work without being signals.
- **Per-component `:root` emission:** every component `@use`s `variables.scss`, which
  re-emits the theme block; harmless but why the prod `anyComponentStyle` budget was
  raised.
