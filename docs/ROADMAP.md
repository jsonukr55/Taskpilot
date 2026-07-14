# TaskPilot — Roadmap & Feature Planning

> Living planning document. Captures features we intend to add, the decisions
> behind them, and their phased breakdown. **Planning only — nothing here is
> implemented until explicitly approved to start.**

Status legend: 🔵 Discussing · 🟡 Planned · 🟠 In progress · 🟢 Done

---

## Feature 1 — Daily Task Report ("Standup") 🟠

### Goal
Make the manager's daily routine effortless. Today the manager hand-writes a
"Daily Task Report" and posts it to Microsoft Teams. We want each team member to
update their own progress/plan in TaskPilot, and the manager to **copy one
pre-formatted report and paste it into Teams** — with the date and "next working
day" always correct.

### Reference output format (must match exactly)
```
Hi Everyone,
Daily Task Report
Date: 13 July 2026 (Monday)
Progress Update
Vikrant
  Worked on Canva widget backend.
Rashika
  Worked on Canva Publish image Frontend.
...
Plan for Tomorrow
Vikrant
  Implement Live Override feature on UDF Platform.
Rashika
  Work on Canva Widget Frontend.
...
```
- Two sections: **Progress Update** (today) and **Plan for Tomorrow** (next working day).
- Grouped by person, in a fixed roster order.
- Header date formatted `D MMMM YYYY (dddd)`.

### Decisions (confirmed with stakeholder)
| # | Decision | Choice |
|---|----------|--------|
| 1 | Source of report lines | **Hybrid (C)** — auto pre-fill from tasks, editable/override before final |
| 2 | Scope | **Single team** (one Group) for now; design for easy multi-team later |
| 3 | Timezone | **IST (GMT+5:30)**, fixed |
| 4 | Absent members | Omit from pasted output by default; show as *Pending* in manager view; explicit **"On leave"** marker renders `Name — On leave` |
| 5 | Editing | Editable until manager **locks**; immutable + archived after lock |
| 6 | Holidays | Stakeholder provides the holiday calendar; we build the engine to consume it |
| 7 | Edit permissions | A member can edit **only their own** tasks/updates. **Only the manager** can edit any member's. Enforced in UI **and** Firestore rules |

> **Note on #7:** stricter than the current Group model, where any `editor`
> edits all group content (`group.model.ts` → `canEdit`). This feature needs
> **ownership-scoped editing** — enforced server-side via Firestore rules
> (`request.auth.uid == resource.data.userId || isManager`), not UI-only.

### Working-day rules
- **Weekends off:** Saturday & Sunday.
- **"Plan for Tomorrow" = next working day:** Friday → Monday; skips holidays.
- **Report date** = current working day in IST (cutoff to be confirmed).
- Holidays come from a company holiday list (stakeholder-provided).

### How it maps onto existing architecture
- **Team = Group** (`group.model.ts`) — manager = `owner`, members = `editor`.
- **Roster & order** — add an ordered member list / order field for the report.
- **Pre-fill source = Tasks** (`task.model.ts`) — Progress from tasks
  worked/completed today; Plan from tasks for the next working day.
- **New Firestore data** — daily report doc per (team, working-day) with
  per-member entries + lock state; a working-calendar/holidays collection.

### Open questions
- [ ] Exact IST cutoff that flips the report to "today".
- [ ] Copy format: plain text only, or also a rich-text variant for Teams?
- [ ] Should indentation/bullets in the paste match a specific Teams style?
- [x] ~~2026 holiday list needed~~ — provided (mandatory + restricted).
- [x] ~~Restricted self-select / max-3 cap~~ — out of scope; manager marks
      "On leave" manually. Restricted list kept as reference data only.
- [x] ~~Who sets "On leave"~~ — **manager** (manager-set marker).

### Holiday calendar (stakeholder-provided)
Source: ASHVAD **Holiday List 2026** (authoritative). The 2025 list was
superseded before any implementation.

**Two categories (important design distinction):**
- **Mandatory (12):** company-wide days off. Drive the **global** working-day
  engine — report date and "next working day" (Fri→Mon, skip mandatory holidays).
- **Restricted (choose any 3):** **per-employee** optional leave from a list.
  NOT a company-wide day off. Handled **outside the app** — members select their
  3 via the normal company process; TaskPilot does **not** build a self-select
  flow or enforce the max-3 cap. Kept below as **reference data** only.

**Design implications:**
- Store the mandatory list in a Firestore collection the **manager can edit
  in-app** (dates are "subject to change" per company policy).
- Global engine unions **weekends + mandatory holidays** only.
- **Restricted holidays are NOT automated.** When a member takes one, the
  **manager manually marks them "On leave"** for that date (Decision #4). The
  restricted table is reference only — no per-employee tracking in-app.
- Lists are **per-year** — re-provided/edited each calendar year.

**Mandatory Holidays 2026 (company-wide, 12)**
| Holiday | Date | Day |
|---------|------|-----|
| Republic Day | 2026-01-26 | Monday |
| Holi | 2026-03-04 | Wednesday |
| Eid al-Fitr | 2026-03-21 | Saturday ⓦ |
| Eid al-Adha | 2026-05-27 | Wednesday |
| Independence Day | 2026-08-15 | Saturday ⓦ |
| Raksha Bandhan | 2026-08-28 | Friday |
| Mahatma Gandhi Jayanti | 2026-10-02 | Friday |
| Dussehra | 2026-10-21 | Wednesday |
| Deepawali | 2026-11-08 | Sunday ⓦ |
| Deepawali | 2026-11-09 | Monday |
| Govardhan Puja | 2026-11-10 | Tuesday |
| Bhai Dooj | 2026-11-11 | Wednesday |

**Restricted Holidays 2026 (per-employee, choose any 3)**
| Holiday | Date | Day |
|---------|------|-----|
| New Year Day | 2026-01-01 | Thursday |
| Maha Shivaratri | 2026-02-15 | Sunday ⓦ |
| Holika Dahan | 2026-03-03 | Tuesday |
| Shri Ram Navami | 2026-03-27 | Friday |
| Mahavir Jayanti | 2026-03-31 | Tuesday |
| Good Friday | 2026-04-03 | Friday |
| Dr. Ambedkar Jayanti | 2026-04-14 | Tuesday |
| Buddha Purnima | 2026-05-01 | Friday |
| Muharram | 2026-06-26 | Friday |
| Eid-e-Milad | 2026-08-25 | Tuesday |
| Krishna Janmashtami | 2026-09-04 | Friday |
| Maha Navami | 2026-10-20 | Tuesday |
| Guru Nanak Jayanti | 2026-11-24 | Tuesday |
| Christmas | 2026-12-25 | Friday |

_ⓦ = already falls on a weekend (Sat/Sun)._

---

### Phase breakdown

#### Phase 0 — Foundations
- Firestore schema: daily report doc (team + working-day) with per-member
  entries and lock state.
- IST working-day + holiday engine: "current working day", "next working day"
  (Fri→Mon, skip holidays), date formatting `D MMMM YYYY (dddd)`.
- Roster + display order on the Group.

#### Phase 1 — Manual MVP (the copy-paste win)
- Member "My Daily Update" screen: Progress list + Plan list (free-text lines).
- Manager compile view: all entries stitched into the exact format.
- **Copy for Teams** button (plain text).
- Auto date header; Plan section targets the next working day.
- Absent handling: *Pending* chips in manager view, omit-from-paste default.
- Lock/finalize (manager) → report becomes read-only + archived.

#### Phase 2 — Hybrid auto pre-fill (Decision C) 🟢 built
- Progress suggestions = your tasks **completed today** (IST) or **in progress**.
- Plan suggestions = your tasks **due the next working day** or **in progress**.
- **Carry-over**: your previous working day's Plan offered under Progress
  ("did you do these?"), fetched on team select.
- Rendered as **click-to-add suggestion chips**; each adds an editable line with
  a `taskId` link. Nothing auto-commits; already-added items drop out.
- **v1 limitation:** suggestions come from `TaskService.tasks()` = tasks you
  *own* (`userId == uid`). Group tasks assigned to you but created by someone
  else aren't surfaced yet — revisit if needed.

#### Phase 3 — Reminders & archive 🟢 built (in-app nudges)
- **In-app nudge**: amber "you haven't submitted today's update" banner when it's
  a working day, unlocked, and you haven't submitted.
- **Manager submitted-count**: "X/Y in" on the Team report header.
- **History/archive**: "Past reports" list per team; open any past report in a
  read-only viewer with Copy for Teams (rich HTML). Sorted client-side (no
  Firestore composite index needed).
- Reminder delivery = **in-app only** for now. Scheduled push/email (Cloud
  Function at a set IST time) deferred — needs FCM/email infra + a deployed fn.
- "On leave" marker + rich-text copy already shipped earlier.

---

### Proposed design (v0.1, approved to build)

**Defaults chosen** (correct anytime): report date flips at **IST midnight**;
**plain-text copy** first (rich text later).

**Data model — thin layer over existing Group + Task**
- `settings/workingCalendar` (global, manager-editable later): `weekends`,
  `holidays[]` (mandatory only), `timezone`. Code ships a 2026 default seed so
  it works before any doc exists.
- `dailyReports/{groupId}_{YYYY-MM-DD}` (parent): `groupId, date, planForDate,
  status('draft'|'locked'), lockedBy, lockedAt, memberOrder[]`.
- `dailyReports/{...}/entries/{uid}` (per member): `progress[], plan[], onLeave,
  submitted, displayName`. Entries as a **subcollection** so Decision #7 falls
  out of rules: write allowed iff `uid == request.auth.uid || isManager`.

**Services**
- `WorkingCalendarService` — pure, IST-anchored: `isWorkingDay`,
  `currentWorkingDay`, `nextWorkingDay` (Fri→Mon, skip holidays), `formatHeader`
  → `13 July 2026 (Monday)`.
- `DailyReportService` — real-time report + entries as Signals; `saveMyEntry`,
  `setMemberLeave`, `lock`; pure `buildReportText` for exact Teams output. First
  member to save that day **lazily creates** the parent doc.

**UI** — one `/daily` page (MVP): member's own Progress/Plan editor + On-leave
toggle + Submit; if manager, a team panel with status chips
(Submitted/Pending/On leave), live preview, **Copy for Teams**, and
**Lock & finalize**. Sidebar gets a "Daily Report" item.

**Permissions (Decision #7)** — enforced in Firestore rules (entry writable by
owner-uid or manager; parent lock = manager only; reads = group members) **and**
mirrored in the UI.

**Build status:** Phase 0 + Phase 1 in progress. Firestore rules updated in
`firestore.rules` — **must be deployed** (`firebase deploy --only
firestore:rules`) before the feature works against the live project.

---

## Feature 2 — _(to be added)_ 🔵

_Pending stakeholder pointers._
