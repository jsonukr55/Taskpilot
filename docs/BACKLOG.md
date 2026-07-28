# TaskPilot — Product Backlog (Boards / Views / Collaboration)

> Derived **strictly** from the PM discussion notes. Items are elaborated and
> organized for clarity and estimation — **no new features were invented**.
> Anything genuinely ambiguous is captured under **Open questions** (to confirm),
> not silently decided.
>
> Reference direction: a focused, Monday.com-style boards + views experience on
> top of the existing Organizations → Spaces → Tasks hierarchy.

## ✅ Decided architecture (Monday structure, TaskPilot names — no rename)

We adopt Monday.com's **structure** but **keep TaskPilot's existing names** (decided —
no rename). We ADD the missing **Group (board-section)** level.

**Hierarchy (TaskPilot names ↔ Monday concept):**
```
Client         (= Monday "Account")  → the customer / company / tenant (top level)
 └─ Organization (= Workspace)        → department / team
     └─ Space     (= Board)           → a project/table where work lives
         └─ Group  (= Group) NEW       → colored section inside a space
             └─ Task  (= Item)         → a row
                 └─ Subtask (= Subitem) → nested row (task.parent_id)
```

| Monday | TaskPilot (keep) | Notes |
|---|---|---|
| Account | **Client** | top tenant = the **customer/company** |
| Workspace | **Organization** | dept/team container |
| Board | **Space** | the project/table |
| Group | **Group / section** | **NEW** — distinct table `space_groups` |
| Item | **Task** | a row |
| Subitem | **Task** (`parent_id`) | nested row |

**Users vs customers (clarified):** an individual who **logs in is a user / member**
(a `profiles` row) — **not** a customer. The **customer = the Client** (top tenant).
Users belong to a Client; a login is never itself a "customer."

**Naming:** keep current names everywhere (DB + code + UI): Client / Organization /
Space / Task. The new board-sections get a **distinct table `space_groups`** (UI label
"Group" — or "Section" if that's clearer next to the legacy feature), so the **legacy
`groups` collaborative feature stays untouched** (decided).

**Roles are two-tiered** (like Monday): an **account-level** role
(Client/Org: Admin / Member / Viewer) **and** a separate **board-level** permission
(Space: owner / editor / viewer) — independent (a person can be an org Member but a
Viewer on one space). Org roles already shipped; space role UI is the remaining bit.

**Impact:** the built **Client → Organization → Space** is correct and **stays as-is**.
We ADD: (1) a **Group/section** level inside spaces (`space_groups`), (2) **Tasks
rendered per group** with per-space columns, (3) the **Views** system on top. No
rename of existing entities.

## How to use this file
- Each **Epic** groups related work with a Goal, Stories, granular **Tasks**
  (checkboxes), **Acceptance criteria**, **Dependencies**, and **Open questions**.
- Update the **Status** column and tick tasks as work progresses.
- Statuses: `Todo` · `In progress` · `Blocked` · `Done`.
- Priority: `P0` (foundational/blocker) · `P1` (core) · `P2` (enhancement).

## Epic overview

| # | Epic | Priority | Status |
|---|------|----------|--------|
| 1 | Projects & Spaces structure | P0 | Done |
| 2 | Boards, Columns & Custom Fields | P0 | Done |
| 3 | Views system (Task / Sprint / custom) | P1 | Done |
| 4 | Task Status & Sprint Status | P1 | Done |
| 5 | Threaded Comments | P1 | Done (text); images w/ Epic 6 |
| 6 | File & Media uploads (storage, types, size, preview) | P1 | Done (task files); comment images TBD |
| 7 | Activity log & debounced Mailer (Redis) | P1 | Todo |
| 8 | Notifications (in-app) | P2 | Done (in-app); email later |
| 9 | Roles & Permissions (admin / member / viewer) | P0 | Done |
| 10 | Admin panel (users, tasks, files, retention) | P1 | Done (files w/ Epic 6) |
| 11 | Multi-tenancy (`client_id` on tenant tree) | P0 | Done |
| 12 | Startup screen & user preferences | P2 | Done |
| 13 | Infrastructure (Postgres, Redis, file storage) | P0 | Partly done |

---

## Epic 1 — Projects & Spaces structure
**Goal:** A user creates **Spaces** for projects; a project holds its own spaces,
and tasks are added inside spaces. (Builds on the existing Org → Space → Task tree.)

**Stories**
- As a user, I can create spaces for a project so each project has its own spaces.
- As a user, I can add tasks inside a space.

**Tasks**
- [ ] Confirm the mapping: **Project** vs existing **Organization/Space** (see Open questions).
- [ ] Space belongs to a project; tasks belong to a space.
- [ ] CRUD for spaces within a project.
- [ ] Add/list tasks within a space.

**Acceptance criteria**
- Creating a project yields a container that can hold multiple spaces.
- Tasks are always created within a space and scoped to it.

**Open questions**
- Is **Project** a new level, or is it the existing **Organization** (Org → Spaces → Tasks)?
  Notes say "one proj will have their own spaces" — need to confirm terminology so
  we don't duplicate the current hierarchy.

---

## Epic 2 — Boards, Columns & Custom Fields
**Goal:** Board view where **every task, including sub-tasks, has its own columns**,
and users can **add columns per space**.

**Stories**
- As a user, I see tasks and sub-tasks in a board with columns.
- As a user, I can add custom columns configured per space.

**Tasks**
- [ ] Board rendering for tasks; sub-tasks also carry their own column values.
- [ ] Column definitions are configured **per space** (add / rename / remove / reorder).
- [ ] Persist column definitions per space; persist per-task/sub-task cell values.
- [ ] Column types (to define — see Open questions) render + edit inline.

**Acceptance criteria**
- Each space can have a distinct set of columns.
- Both tasks and sub-tasks display and store values for those columns.

**Open questions**
- What **column types** are needed (text, number, date, status, person, dropdown…)?
  Notes say "add columns as per spaces" but not the types.
- Do sub-tasks share the parent's column set or have independent columns?
  Notes: "even sub task will have their own columns" → leaning independent; confirm.

---

## Epic 3 — Views system (Task / Sprint / custom)
**Goal:** A common **Views** system. Multiple views per project, switchable, with a
saved preference per user per project.

**Stories & requirements (verbatim intent)**
- Support **multiple project views**.
- **Task View** is the **default** predefined view.
- Add a new predefined **Sprint View**.
- Users can **switch** between available views within a project.
- **Save view preference per user per project.**
- On open, **automatically open the last selected view** for each project.
- View preference is **independent for every project**.
- Users can **create custom views** via a **"+" (Add View)** option → a **"Create View" flow**.
- Views are **configured by Group By** criteria; support **Group By → Task Status**.
- Treat **Task View, Sprint View, and all future views under one common Views system.**

**Tasks**
- [ ] Views data model: a view belongs to a project, has a type/name and a `groupBy` config.
- [ ] Seed predefined views: **Task View** (default) and **Sprint View**.
- [ ] View switcher UI within a project.
- [ ] Persist **last-selected view per user per project**; auto-open it next time.
- [ ] "+" Add View entry point → **Create View** flow (name + Group By).
- [ ] Group By engine; first supported criterion: **Task Status**.
- [ ] Extensible so future view types plug into the same Views system.

**Acceptance criteria**
- Each project shows its available views; switching persists per user, per project.
- Reopening a project restores that user's last view for *that* project only.
- A custom view created via "+" appears alongside predefined views.

**Open questions**
- Are custom views shared across the project or private to the creating user?
- Besides Group By Status/Sprint, are other Group By criteria in scope now? (Notes
  restrict Sprint grouping away from tags — see Epic 4.)

---

## Epic 4 — Task Status & Sprint Status
**Goal:** Status-driven grouping. Sprint View groups by a **Sprint Status**, **not tags**.

**Requirements (verbatim intent)**
- Grouping uses **task Status**, **not tags** (explicitly: do **not** use tags for Sprint View).
- Default **task statuses**: `Created`, `In Discussion`, `Development`, `Done`, `Released`, `Production`.
- Introduce a **Sprint Status** (e.g., `Sprint 1`, `Sprint 2`, …).
- Tasks can be **assigned to a Sprint Status**.
- **Sprint View** is generated by grouping tasks by **Sprint Status**.
- Sprint View behaves as a **grouped view based on Sprint Status**.

**Tasks**
- [ ] Define the default task-status set above (replace/extend current statuses — see Open questions).
- [ ] Add a **Sprint Status** field on tasks (`Sprint 1`, `Sprint 2`, … configurable per project).
- [ ] Assign/change a task's Sprint Status.
- [ ] Task View = group by **Task Status**; Sprint View = group by **Sprint Status**.
- [ ] Ensure tags are **not** used for Sprint grouping anywhere.

**Acceptance criteria**
- Sprint View shows columns/groups per Sprint Status; moving a task changes its Sprint Status.
- Task View shows groups per Task Status; the two groupings are independent.

**Open questions**
- The new default statuses differ from the current app statuses
  (`todo/in_progress/completed/cancelled`). Migrate/replace, or map? Confirm the
  transition and any data migration.
- Are Sprint Statuses defined per project? Who manages the sprint list?

---

## Epic 5 — Threaded Comments
**Goal:** **Comments as post + reply threads** on each task, with **image attachments**.

**Stories**
- As a user, I can post a comment on a task and reply to comments (threaded).
- As a user, I can attach images to a comment.

**Tasks**
- [x] Comment model supporting parent/child (post → replies) per task.
  *(`task_comments` with `parent_id`; migration 0013)*
- [x] Post, reply, edit, delete within permissions. *(RLS: view mirrors task
  visibility; posting requires task edit rights so viewers are read-only;
  edit/delete restricted to the author.)*
- [ ] Image upload inside comments — **deferred to Epic 6** (file storage).
- [ ] Render inline image thumbnails; open in media preview — **deferred to Epic 6**.

**Acceptance criteria**
- ✅ A task shows a threaded discussion; replies nest under their post (one level).
- ⏳ Image attachments — pending Epic 6 (storage).

**Implementation notes**
- `task_comments` table (threaded via `parent_id`, `client_id` auto-stamped from the
  parent task), realtime channel per task. `TaskCommentService` (open/close + add/edit/
  remove), `TaskCommentsComponent` mounted in the task drawer. Text-first; the composer,
  reply and edit are inline. RLS helpers `can_view_task` / `can_comment_task`.

**Open questions**
- ~~Thread depth~~ ✅ **RESOLVED** — one-level (post → replies), matching "post and reply
  thread". Deeper nesting can layer on later if needed.
- Mentions/@notifications in comments — out of scope for now (ties into Epic 8).

---

## Epic 6 — File & Media uploads (storage, types, size, preview)
**Goal:** Upload files (incl. comment images) to a **file-system folder**, restricted
to allowed types, with sizes tracked and a **small media preview dialog**.

**Requirements (verbatim intent)**
- Image/file upload stored **as file system in a folder**.
- **Allowed file types:** Video, PDF, ZIP, and other known types.
- Track **file upload size of all files**.
- **Media preview in small dialogs.**

**Tasks**
- [ ] File-system storage layout (folders per task/space/tenant — see Open questions).
- [ ] Upload endpoint with **allowed-type validation** (video, pdf, zip, known types).
- [ ] Store file metadata (name, type, size, owner, task/comment ref).
- [ ] Aggregate **total upload size** (per task, per space, per company — used by Admin, Epic 10).
- [ ] Thumbnails/preview; **small dialog** preview for images/video/pdf.
- [ ] Enforce per-file / total size limits (see Open questions).

**Acceptance criteria**
- Only allowed types upload; disallowed types are rejected with a clear message.
- Each file records its size; totals are queryable.
- Clicking a media item opens a compact preview dialog (per UI_GUIDELINES modal rules).

**Open questions**
- Where does the file system live (server disk, mounted volume, object storage)?
  Notes say "file systems in a folder" — confirm the target, esp. for the Azure plan.
- Exact **allowed extensions** list and **max size** (per file / per company).

---

## Epic 7 — Activity log & debounced Mailer (Redis)
**Goal:** Keep **all task activities**; the **mailer waits for further changes on the
same task** and batches them, with a **max 1-minute wait threshold**, **auto-clean**,
using **Redis keyed by task id**.

**Requirements (verbatim intent)**
- Mailer **waits for changes in the same task** and **keeps all the activities**.
- **Max 1-minute** wait threshold, then send; **auto-clean**.
- **Redis checks the task id** (debounce key per task).
- Maintain a full **activity log**.

**Tasks**
- [ ] Activity log: record every task change (who/what/when) durably.
- [ ] Redis debounce keyed by `task_id`: reset/extend timer on each change.
- [ ] **1-minute** ceiling — send the batched activity email even if changes keep coming.
- [ ] Compose the email from the accumulated activities for that task.
- [ ] Auto-clean Redis keys after send / on expiry.

**Acceptance criteria**
- Rapid edits to one task collapse into a single email, sent within ≤ 1 minute.
- The email lists all activities accumulated during the window.
- Redis keys are removed after send; no leaks.

**Open questions**
- Who receives the activity mail (assignees, watchers, whole space)?
- Email transport/provider? (Ties into the Azure/Supabase decision.)

---

## Epic 8 — Notifications
**Goal:** Notify a user when a task is **assigned** to them.

**Tasks**
- [x] Trigger a notification to the assignee on task assignment — **server-side**
  DB trigger on `tasks.assignee_ids` (`notify_task_assignment`), so every path
  (board, drawer, ETL, future API) notifies newly-added assignees; the actor is
  never self-notified. *(migration 0014)*
- [x] In-app delivery: `notifications` table + `NotificationService` (realtime feed,
  unread count) + a bell in the topbar (badge, dropdown, mark-read / mark-all-read,
  dismiss, click → open). RLS: each user sees/updates only their own rows.
- [ ] **Email** delivery — deferred; will ride on Epic 7's mailer (needs email provider).

**Acceptance criteria**
- ✅ Assigning a task to a user produces an in-app notification to that assignee.

**Open questions**
- ~~Channel: in-app, email, or both?~~ ✅ **RESOLVED for now** — in-app shipped; email
  layers on with Epic 7 (shared mailer) once a provider is chosen.

---

## Epic 9 — Roles & Permissions
**Goal:** Three roles — **admin, member, viewer** — governing access.

**Tasks**
- [x] Define role set — two-tier: **org** (owner/admin/member/viewer) + **space**
  (owner/editor/viewer), independent. *(shipped earlier: 0006 + space roles)*
- [x] Enforce permissions across spaces/tasks/sections/columns (viewer = read-only).
  Content writes gated by `can_edit_space` (owner/editor); viewers read-only. *(0002/0007/0010)*
- [x] Org viewers are read-only → **cannot create spaces** (`can_edit_org` gate). *(0012)*
- [x] Org **managers** (owner/admin/global admin) can see and manage membership of every
  space in their org — even spaces they didn't join. *(0012: spaces_select/update/delete +
  space_members policies)*
- [x] **Space role-management UI** — members dialog on the board: add member (with role),
  change role (editor/viewer; owner locked), remove. Gated to space owner + org managers;
  viewers see a read-only member list. *(space-detail)*
- [x] Client-side gates mirror RLS: "New space" hidden from org viewers (`canEditOrg`);
  member controls shown only to `canManageMembers`.

**Acceptance criteria**
- ✅ Viewers cannot edit; members/editors can edit within scope; owners + admins manage.
- ✅ Board membership is manageable from the Space UI with per-member roles.

**Open questions**
- ~~Scope of each role~~ ✅ **RESOLVED** — org role governs org-level actions (create
  spaces, manage members); space role governs board content. The two are independent
  (an org member can be a viewer on a given space). Global super-admin overrides.
- Note: threaded comments / file uploads (Epics 5–6) will reuse `can_edit_space` /
  membership when those tables land — no new role concepts needed.

---

## Epic 10 — Admin panel
**Goal:** An admin area to **manage users**, **see all tasks and sub-tasks**, and view
**file uploads with the size of all files**; plus company **data retention shown in one place**.

**Requirements (verbatim intent)**
- Admin panel to **manage users**.
- **Show all tasks and sub-tasks.**
- Show **file uploads** and **size of all files**.
- **Company data retention** — show in one place.

**Tasks**
- [x] User management — list all users with global role; promote/remove admin inline.
  *(admin RLS read on profiles; migration 0020)*
- [x] Global view of all tasks + sub-tasks — counts (tasks / subtasks / total) + per-stage
  breakdown across the whole platform. *(admin RLS read on tasks)*
- [ ] Files dashboard: list uploads + **total size of all files** — **deferred to Epic 6**.
- [x] Data-retention / footprint view — per-client data held (orgs · spaces · tasks) in one place.
  *(admin RLS read on spaces)*

**Acceptance criteria**
- ✅ Admin can manage users and review all tasks/sub-tasks and per-client data footprint from one panel.
- ⏳ File usage — pending Epic 6.

**Implementation notes**
- `AdminService.allUsers / allTasks / allSpaces` (RLS-gated to `is_global_admin`). The
  panel loads them on open and computes stats + footprint client-side. Existing
  client/org/admin management retained.

**Open questions**
- "Company data retention" period/purge policy still undefined — the footprint view shows
  current data held; a retention *policy* (auto-purge windows) is a later decision.

---

## Epic 11 — Multi-tenancy (`client_id` on all tables)
**Goal:** True multi-tenant isolation — **every table carries a `client_id`**.

**Requirements (verbatim intent)**
- **Multiple tenants**; **all tables will have `client_id`.**

**Scope decision (confirmed):** tenancy applies to the **Org → Space → Task tree ONLY**.
The parallel **personal / legacy-Groups layer** (profiles, groups, group_members,
invites, notes, note_comments, daily_reports, daily_entries, categories, insights,
schedules, and *personal* tasks) is **left untouched** — it is per-user, not per-tenant
(per the original "Groups and personal tasks left completely untouched" decision).

**Tasks**
- [x] Add `client_id` to the tenant-tree tables: `spaces`, `space_groups`,
  `space_columns`, `space_members`, `org_members`, `org_invites`, `tasks`
  (`organizations` already had it). *(migration 0011)*
- [x] Backfill existing rows from their parent org/space. *(0 orphans; org_members 2/2,
  org_invites 1/1; all 79 existing tasks are personal → correctly left null.)*
- [x] Enforce tenant isolation in RLS — guaranteed transitively by the existing
  membership policies (`is_org_member`/`is_space_member`): a user is only ever a member
  within one client's tree, so cross-tenant reads are impossible. `client_id` makes the
  tenancy explicit for reporting + tenant-scoped features.
- [x] Ensure new records always stamp `client_id` — BEFORE INSERT/UPDATE triggers
  auto-derive it from the parent (`stamp_client_from_org` / `_from_space` / `_task`),
  so **no app code changes** were needed. Trigger fns had their RPC execute grant
  revoked (trigger-only, not callable).

**Acceptance criteria**
- ✅ Data is isolated per client across the tenant tree; cross-tenant reads are impossible.
- ✅ Every tenant-tree row (existing + new) carries its owning `client_id`.

**Azure portability:** standard PostgreSQL columns/FKs/triggers/indexes — moves as-is to
Azure Database for PostgreSQL via `pg_dump`.

**Open questions**
- ~~Does tenancy apply to Groups/personal tasks or only the Org → Space → Task tree?~~
  ✅ **RESOLVED** — tenant tree only; personal/Groups layer stays per-user (untouched).

---

## Epic 12 — Startup screen & user preferences
**Goal:** A user can **set any project as their startup screen**; on login it opens first.

**Requirements (verbatim intent)**
- **Set any project as startup screen.**
- On login, the **startup screen shows up**.

**Tasks**
- [x] "Set as startup screen" action on a Space (board header ⋯ menu; toggles
  set/remove, with a star indicator next to the space name when active).
- [x] Persist the startup preference per user (`profiles.preferences.startupSpaceId`
  + `startupOrgId`; via `AuthService.setStartupSpace/clearStartupSpace`).
- [x] On login, route to the chosen startup Space — handled in the `SIGNED_IN`
  auth event (`routeAfterLogin`): explicit `returnUrl` wins, else the startup
  Space, else `/dashboard`. Guarded to only take over from an auth/landing route
  so it never hijacks deep navigation.

**Acceptance criteria**
- ✅ After setting a startup Space, logging in opens that Space first.

**Open questions**
- ~~Startup preference is global per user (one)~~ ✅ **RESOLVED** — one global startup
  Space per user, stored on the profile (not per-tenant).

---

## Epic 13 — Infrastructure
**Goal:** Foundational platform: **Postgres**, **Redis**, and **file-system storage**.

**Requirements (verbatim intent)**
- **Change DB to Postgres.**
- **Redis** (for the debounced mailer + task-id checks).
- **File-system** storage for uploads.

**Tasks**
- [x] **Postgres** — migrated (Firebase/Firestore → Supabase Postgres). *(Done earlier.)*
- [ ] **Redis** — provision + integrate (used by Epic 7).
- [ ] **File storage** — provision the upload file system (used by Epic 6).

**Acceptance criteria**
- Postgres is the system of record (done); Redis and file storage are available to the app.

**Open questions**
- Redis + file-storage hosting (ties into the "Supabase now → Azure at launch" plan).

---

## Cross-cutting notes
- **UI**: every screen here must follow **[docs/UI_GUIDELINES.md](UI_GUIDELINES.md)**
  (boards, view switcher, create-view flow, comment threads, media preview dialogs,
  admin tables — all use the shared tokens/components).
- **Overlap with completed work**: Postgres migration (Epic 13) and `client_id` on
  `organizations` (Epic 11) are already in place from the Supabase migration.
- **Sequencing suggestion (not a scope change):** foundational epics (1, 2, 9, 11, 13)
  unblock the rest; Views (3) + Statuses (4) are the core Monday-style experience;
  Comments/Files/Activity (5–7) layer collaboration on top.

## Consolidated open questions (confirm with PM)
1. ~~**Project vs Organization** terminology~~ ✅ **RESOLVED** — Space = Board = the
   project; no separate Project level. Names kept (Client/Org/Space/Task); add a
   Group/section level. Client = customer; logins = users, not customers.
2. **Column types** and whether sub-tasks have independent columns (Epic 2).
3. **Custom views**: shared vs per-user; other Group By criteria (Epic 3).
4. **Task status migration** from current statuses to the new set; sprint-list ownership (Epic 4).
5. **Comment thread depth**; mentions in/out of scope (Epic 5).
6. **File storage target**, allowed extensions, size limits (Epic 6).
7. **Mailer recipients** + email provider (Epics 7–8).
8. **Notification channels** (Epic 8).
9. **Role scope** and reconciliation with existing roles (Epic 9).
10. **Data-retention policy** definition (Epic 10).
11. ~~**Tenancy scope** for Groups/personal layer (Epic 11).~~ ✅ **RESOLVED** — tenant
    tree only; personal/Groups layer stays per-user (untouched).
