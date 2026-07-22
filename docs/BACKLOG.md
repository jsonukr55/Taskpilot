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
| 1 | Projects & Spaces structure | P0 | Todo |
| 2 | Boards, Columns & Custom Fields | P0 | Todo |
| 3 | Views system (Task / Sprint / custom) | P1 | Todo |
| 4 | Task Status & Sprint Status | P1 | Todo |
| 5 | Threaded Comments | P1 | Todo |
| 6 | File & Media uploads (storage, types, size, preview) | P1 | Todo |
| 7 | Activity log & debounced Mailer (Redis) | P1 | Todo |
| 8 | Notifications | P2 | Todo |
| 9 | Roles & Permissions (admin / member / viewer) | P0 | Todo |
| 10 | Admin panel (users, tasks, files, retention) | P1 | Todo |
| 11 | Multi-tenancy (`client_id` on all tables) | P0 | Todo |
| 12 | Startup screen & user preferences | P2 | Todo |
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
- [ ] Comment model supporting parent/child (post → replies) per task.
- [ ] Post, reply, edit, delete within permissions.
- [ ] Image upload inside comments (stored via the file system — see Epic 6).
- [ ] Render inline image thumbnails; open in media preview (see Epic 6).

**Acceptance criteria**
- A task shows a threaded discussion; replies nest under their post.
- Images attached to a comment display as thumbnails and open in a preview dialog.

**Open questions**
- Thread depth: single-level replies or fully nested? Notes say "post and reply thread".
- Mentions/@notifications in comments — in scope? (Not stated; default: out of scope.)

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
- [ ] Trigger a notification to the assignee on task assignment.
- [ ] Delivery channel(s) — see Open questions.

**Acceptance criteria**
- Assigning a task to a user produces a notification to that assignee.

**Open questions**
- Channel: in-app, email, or both? Notes only say "Notifications to assignment of
  task to assignee." (Assignment email may overlap with Epic 7's mailer.)

---

## Epic 9 — Roles & Permissions
**Goal:** Three roles — **admin, member, viewer** — governing access.

**Tasks**
- [ ] Define role set: `admin`, `member`, `viewer`.
- [ ] Enforce permissions across boards/spaces/tasks/comments/files (viewer = read-only).
- [ ] Wire roles into RLS / access checks.

**Acceptance criteria**
- Viewers cannot edit; members can edit within scope; admins manage.

**Open questions**
- Scope of each role (per space, per project, per company?).
- Relationship to existing global super-admin + space/group roles already in the app.

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
- [ ] User management (list, roles, add/remove).
- [ ] Global view of all tasks + sub-tasks.
- [ ] Files dashboard: list uploads + **total size of all files** (per Epic 6 aggregation).
- [ ] Data-retention view: surface the company's retention info in one place.

**Acceptance criteria**
- Admin can manage users and review all tasks/sub-tasks and file usage from one panel.
- Retention information is visible in a single location.

**Open questions**
- What does "company data retention" cover (period, what's retained/purged)? Define the policy.

---

## Epic 11 — Multi-tenancy (`client_id` on all tables)
**Goal:** True multi-tenant isolation — **every table carries a `client_id`**.

**Requirements (verbatim intent)**
- **Multiple tenants**; **all tables will have `client_id`.**

**Tasks**
- [ ] Add `client_id` to **all** domain tables (currently only `organizations` has it).
- [ ] Backfill / assign existing rows to a client.
- [ ] Enforce tenant isolation in RLS (rows filtered by tenant).
- [ ] Ensure new records always stamp `client_id`.

**Acceptance criteria**
- Data is isolated per client across every table; cross-tenant reads are impossible.

**Open questions**
- Does tenancy also apply to Groups/personal tasks (currently a parallel, non-tenant
  layer), or only the Org → Space → Task tree? (Earlier decision scoped client to orgs.)

---

## Epic 12 — Startup screen & user preferences
**Goal:** A user can **set any project as their startup screen**; on login it opens first.

**Requirements (verbatim intent)**
- **Set any project as startup screen.**
- On login, the **startup screen shows up**.

**Tasks**
- [ ] "Set as startup screen" action on a project.
- [ ] Persist the startup preference per user.
- [ ] On login, route to the chosen startup project (fallback to default when unset).

**Acceptance criteria**
- After setting a startup project, logging in opens that project first.

**Open questions**
- Startup preference is global per user (one) — confirm it's not per-tenant.

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
11. **Tenancy scope** for Groups/personal layer (Epic 11).
