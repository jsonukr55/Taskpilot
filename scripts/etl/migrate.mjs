// ============================================================
// TaskPilot ETL — Firestore + Firebase Auth  →  Supabase (Postgres)
//
// Migrates ONLY Google-authenticated users (per project decision) and
// ALL of their data. Firebase uids (strings) are remapped to the new
// Supabase Auth uuids; every reference (userId, assigneeIds, memberIds,
// roles/memberProfiles keys, ownerId, createdBy, lockedBy, memberOrder,
// authorId…) is rewritten through that map. Firestore Timestamps become
// ISO strings (incl. those nested in JSONB: checklist, timeBlocks,
// recurrence, preferences, stats, note blocks…).
//
// Idempotent: every write is an upsert, so it's safe to re-run.
//
// Run:  see scripts/etl/README.md  (needs firebase-admin + @supabase/supabase-js)
//   node scripts/etl/migrate.mjs
// ============================================================
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';

// ---- Load scripts/etl/.env (no dependency) ------------------
for (const envPath of ['scripts/etl/.env', '.env']) {
  if (!existsSync(envPath)) continue;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  break;
}

// ---- Config -------------------------------------------------
const SA_PATH  = process.env.FIREBASE_SA_PATH || '.secrets/firebase-admin.json';
const SUPA_URL = process.env.SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DRY_RUN  = process.env.DRY_RUN === '1';

if (!SUPA_URL || !SUPA_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. See scripts/etl/README.md');
  process.exit(1);
}

const serviceAccount = JSON.parse(readFileSync(SA_PATH, 'utf8'));
initializeApp({ credential: cert(serviceAccount) });
const fdb = getFirestore();
const fauth = getAuth();
const supa = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

// ---- uid map + helpers -------------------------------------
const uidMap = new Map();                       // firebaseUid -> supabaseUuid
const mapUid  = (u) => (u ? (uidMap.get(u) ?? null) : null);
const mapUids = (a) => (a ?? []).map(mapUid).filter(Boolean);

const stats = { users: 0, skipped: 0 };

function tsToIso(v) {
  if (v == null) return null;
  if (typeof v?.toDate === 'function') return v.toDate().toISOString();
  if (typeof v?._seconds === 'number')  return new Date(v._seconds * 1000).toISOString();
  if (typeof v?.seconds === 'number')   return new Date(v.seconds * 1000).toISOString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string') return v;
  return null;
}

/** Recursively convert any Firestore Timestamps nested inside JSON-ish data. */
function deepTs(o) {
  if (o == null) return o;
  if (typeof o?.toDate === 'function') return o.toDate().toISOString();
  if (typeof o?._seconds === 'number' && Object.keys(o).length <= 2) return new Date(o._seconds * 1000).toISOString();
  if (Array.isArray(o)) return o.map(deepTs);
  if (typeof o === 'object') {
    const r = {};
    for (const [k, val] of Object.entries(o)) r[k] = deepTs(val);
    return r;
  }
  return o;
}

async function upsert(table, rows, onConflict = 'id') {
  const clean = rows.filter(Boolean);
  if (!clean.length) return;
  if (DRY_RUN) { console.log(`  [dry] ${table}: ${clean.length} rows`); return; }
  for (let i = 0; i < clean.length; i += 500) {
    const slice = clean.slice(i, i + 500);
    const { error } = await supa.from(table).upsert(slice, { onConflict });
    if (error) console.error(`  ! upsert ${table}[${i}]: ${error.message}`);
  }
  console.log(`  ✓ ${table}: ${clean.length} rows`);
}

async function readCol(path) {
  const snap = await fdb.collection(path).get();
  return snap.docs;
}

// ============================================================
// 1) Users → Supabase Auth + profiles  (Google users only)
// ============================================================
async function migrateUsers() {
  console.log('Users (Google-auth only) → auth + profiles');

  // Pre-index existing Supabase auth users by email for idempotent re-runs.
  const existing = new Map();
  for (let page = 1; ; page++) {
    const { data, error } = await supa.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) { console.error('  listUsers:', error.message); break; }
    data.users.forEach(u => u.email && existing.set(u.email.toLowerCase(), u.id));
    if (data.users.length < 1000) break;
  }

  let pageToken;
  do {
    const res = await fauth.listUsers(1000, pageToken);
    for (const u of res.users) {
      const isGoogle = u.providerData.some(p => p.providerId === 'google.com');
      if (!isGoogle || !u.email) { stats.skipped++; continue; }

      const psnap = await fdb.collection('users').doc(u.uid).get();
      const p = psnap.exists ? psnap.data() : {};
      const displayName = p.displayName || u.displayName || u.email;
      const photoURL    = p.photoURL ?? u.photoURL ?? null;

      let supaId = existing.get(u.email.toLowerCase());
      if (!supaId && !DRY_RUN) {
        const { data, error } = await supa.auth.admin.createUser({
          email: u.email,
          email_confirm: true,
          user_metadata: { displayName, full_name: displayName, avatar_url: photoURL, picture: photoURL },
        });
        if (error) { console.error(`  ! createUser ${u.email}: ${error.message}`); continue; }
        supaId = data.user.id;
        existing.set(u.email.toLowerCase(), supaId);
      }
      if (!supaId) { supaId = `dry-${u.uid}`; }   // dry-run placeholder
      uidMap.set(u.uid, supaId);
      stats.users++;

      await upsert('profiles', [{
        id: supaId,
        email: u.email,
        display_name: displayName,
        photo_url: photoURL,
        global_role: p.globalRole === 'admin' ? 'admin' : null,
        preferences: deepTs(p.preferences) ?? {},
        stats: deepTs(p.stats) ?? {},
        calendar_integrations: deepTs(p.calendarIntegrations) ?? [],
        seen_insight_ids: p.seenInsightIds ?? [],
        note_access: deepTs(p.noteAccess) ?? null,
        created_at: tsToIso(p.createdAt),
        updated_at: tsToIso(p.updatedAt),
      }]);
    }
    pageToken = res.pageToken;
  } while (pageToken);

  console.log(`  → ${stats.users} migrated, ${stats.skipped} skipped (non-Google/no-email)`);
}

// ============================================================
// 2) Categories  (self-referential parent_id → two passes)
// ============================================================
async function migrateCategories() {
  console.log('Categories');
  const docs = await readCol('categories');
  const rows = docs.map(d => {
    const c = d.data(); const uid = mapUid(c.userId);
    if (!uid) return null;
    return {
      id: d.id, user_id: uid, name: c.name, description: c.description ?? null,
      icon: c.icon ?? '📁', color: c.color ?? '#6366f1', parent_id: c.parentId ?? null,
      keywords: c.keywords ?? [], rules: deepTs(c.rules) ?? {}, order: c.order ?? 0,
      created_at: tsToIso(c.createdAt), updated_at: tsToIso(c.updatedAt),
    };
  }).filter(Boolean);
  await upsert('categories', rows.map(r => ({ ...r, parent_id: null })));   // pass 1
  for (const r of rows) if (r.parent_id && !DRY_RUN)
    await supa.from('categories').update({ parent_id: r.parent_id }).eq('id', r.id);   // pass 2
}

// ============================================================
// 3) Groups + members + group notes/comments
// ============================================================
function membersFrom(entity, idKey, entityId) {
  const out = [];
  for (const fbUid of (entity.memberIds ?? [])) {
    const uid = mapUid(fbUid); if (!uid) continue;
    const prof = entity.memberProfiles?.[fbUid] ?? {};
    out.push({
      [idKey]: entityId, user_id: uid, role: entity.roles?.[fbUid] ?? 'viewer',
      display_name: prof.displayName ?? 'Member', photo_url: prof.photoURL ?? null,
    });
  }
  return out;
}

async function migrateNotesUnder(colPath, groupId) {
  const docs = await readCol(colPath);
  const noteRows = [];
  for (const d of docs) {
    const n = d.data();
    const cb = mapUid(n.createdBy), ub = mapUid(n.updatedBy) ?? cb;
    const owner = groupId ? null : mapUid(n.ownerId);
    if (!cb || (!groupId && !owner)) continue;
    noteRows.push({
      id: d.id, group_id: groupId ?? null, owner_id: owner,
      title: n.title ?? 'Untitled', icon: n.icon ?? '📄', blocks: deepTs(n.blocks) ?? [],
      created_by: cb, updated_by: ub, created_at: tsToIso(n.createdAt), updated_at: tsToIso(n.updatedAt),
    });
  }
  await upsert('notes', noteRows);
  for (const d of docs) {
    const cdocs = await readCol(`${colPath}/${d.id}/comments`);
    const crows = cdocs.map(cd => {
      const c = cd.data(); const aid = mapUid(c.authorId); if (!aid) return null;
      return {
        id: cd.id, note_id: d.id, block_id: c.blockId, author_id: aid,
        author_name: c.authorName ?? 'Member', author_photo: c.authorPhoto ?? null,
        body: c.body ?? '', resolved: c.resolved ?? false,
        created_at: tsToIso(c.createdAt), updated_at: tsToIso(c.updatedAt),
      };
    });
    await upsert('note_comments', crows);
  }
}

async function migrateGroups() {
  console.log('Groups + members + notes');
  const docs = await readCol('groups');
  const groupRows = [], memberRows = [];
  for (const d of docs) {
    const g = d.data(); const owner = mapUid(g.ownerId); if (!owner) continue;
    groupRows.push({
      id: d.id, name: g.name, description: g.description ?? null, icon: g.icon ?? '👥',
      color: g.color ?? '#6366f1', owner_id: owner,
      created_at: tsToIso(g.createdAt), updated_at: tsToIso(g.updatedAt),
    });
    memberRows.push(...membersFrom(g, 'group_id', d.id));
  }
  await upsert('groups', groupRows);
  await upsert('group_members', memberRows, 'group_id,user_id');
  for (const d of docs) await migrateNotesUnder(`groups/${d.id}/notes`, d.id);
}

// ============================================================
// 4) Organizations + members, 5) Spaces + members
// ============================================================
async function migrateOrganizations() {
  console.log('Organizations + members');
  const docs = await readCol('organizations');
  const orgRows = [], memberRows = [];
  for (const d of docs) {
    const o = d.data(); const owner = mapUid(o.ownerId); if (!owner) continue;
    orgRows.push({
      id: d.id, name: o.name, description: o.description ?? null, icon: o.icon ?? '🏢',
      color: o.color ?? '#6366f1', client_id: null, owner_id: owner,
      created_by: mapUid(o.createdBy) ?? owner,
      created_at: tsToIso(o.createdAt), updated_at: tsToIso(o.updatedAt),
    });
    memberRows.push(...membersFrom(o, 'org_id', d.id).map(m => ({
      ...m, role: m.role === 'owner' ? 'owner' : 'member',
    })));
  }
  await upsert('organizations', orgRows);
  await upsert('org_members', memberRows, 'org_id,user_id');
}

async function migrateSpaces() {
  console.log('Spaces + members');
  const docs = await readCol('spaces');
  const spaceRows = [], memberRows = [];
  for (const d of docs) {
    const s = d.data(); const owner = mapUid(s.ownerId); if (!owner) continue;
    spaceRows.push({
      id: d.id, org_id: s.orgId, name: s.name, description: s.description ?? null,
      icon: s.icon ?? '📁', color: s.color ?? '#6366f1', owner_id: owner,
      created_by: mapUid(s.createdBy) ?? owner,
      created_at: tsToIso(s.createdAt), updated_at: tsToIso(s.updatedAt),
    });
    memberRows.push(...membersFrom(s, 'space_id', d.id));
  }
  await upsert('spaces', spaceRows);
  await upsert('space_members', memberRows, 'space_id,user_id');
}

// ============================================================
// 6) Tasks  (self-referential parent_id → two passes)
// ============================================================
async function migrateTasks() {
  console.log('Tasks');
  const docs = await readCol('tasks');
  const rows = docs.map(d => {
    const t = d.data(); const uid = mapUid(t.userId); if (!uid) return null;
    return {
      id: d.id, user_id: uid, group_id: t.groupId ?? null, org_id: t.orgId ?? null,
      space_id: t.spaceId ?? null, assignee_ids: mapUids(t.assigneeIds), title: t.title,
      description: t.description ?? null, status: t.status ?? 'todo', priority: t.priority ?? 'medium',
      start_date: tsToIso(t.startDate), due_date: tsToIso(t.dueDate), due_time: t.dueTime ?? null,
      completed_at: tsToIso(t.completedAt), estimated_hours: t.estimatedHours ?? null,
      actual_hours: t.actualHours ?? null, parent_id: t.parentId ?? null,
      category_ids: t.categoryIds ?? [], tags: t.tags ?? [],
      checklist: deepTs(t.checklist) ?? [], time_blocks: deepTs(t.timeBlocks) ?? [],
      recurrence: deepTs(t.recurrence) ?? null, is_scheduled: t.isScheduled ?? false,
      ai_metadata: deepTs(t.aiMetadata) ?? null, image_url: t.imageUrl ?? null,
      reminders: deepTs(t.reminders) ?? [], created_at: tsToIso(t.createdAt), updated_at: tsToIso(t.updatedAt),
    };
  }).filter(Boolean);
  await upsert('tasks', rows.map(r => ({ ...r, parent_id: null })));   // pass 1
  for (const r of rows) if (r.parent_id && !DRY_RUN)
    await supa.from('tasks').update({ parent_id: r.parent_id }).eq('id', r.id);   // pass 2
}

// ============================================================
// 7) Daily reports + entries  (id = `${groupId}_${date}` kept)
// ============================================================
async function migrateDailyReports() {
  console.log('Daily reports + entries');
  const docs = await readCol('dailyReports');
  const rows = docs.map(d => {
    const r = d.data();
    return {
      id: d.id, group_id: r.groupId, date: r.date, plan_for_date: r.planForDate,
      status: r.status ?? 'draft', locked_by: mapUid(r.lockedBy), locked_at: tsToIso(r.lockedAt),
      member_order: mapUids(r.memberOrder), note_id: r.noteId ?? null,
      created_at: tsToIso(r.createdAt), updated_at: tsToIso(r.updatedAt),
    };
  });
  await upsert('daily_reports', rows);
  for (const d of docs) {
    const edocs = await readCol(`dailyReports/${d.id}/entries`);
    const erows = edocs.map(ed => {
      const e = ed.data(); const uid = mapUid(e.userId); if (!uid) return null;
      return {
        report_id: d.id, user_id: uid, display_name: e.displayName ?? 'Member',
        photo_url: e.photoURL ?? null, progress: e.progress ?? [], plan: e.plan ?? [],
        on_leave: e.onLeave ?? false, submitted: e.submitted ?? false, updated_at: tsToIso(e.updatedAt),
      };
    });
    await upsert('daily_entries', erows, 'report_id,user_id');
  }
}

// ============================================================
// 8) Schedules, 9) Insights, 10) Invites, 11) Settings
// ============================================================
async function migrateSchedules() {
  console.log('Schedules');
  const docs = await readCol('schedules');
  await upsert('schedules', docs.map(d => {
    const s = d.data(); const uid = mapUid(s.userId); if (!uid) return null;
    return {
      id: d.id, user_id: uid, task_id: s.taskId ?? null, start_time: tsToIso(s.startTime),
      end_time: tsToIso(s.endTime), auto_scheduled: s.autoScheduled ?? false,
      calendar_event_id: s.calendarEventId ?? null, provider: s.provider ?? null,
      has_conflict: s.hasConflict ?? false, conflict_with: s.conflictWith ?? [],
      created_at: tsToIso(s.createdAt), updated_at: tsToIso(s.updatedAt),
    };
  }));
}

async function migrateInsights() {
  console.log('Insights');
  const docs = await readCol('insights');
  await upsert('insights', docs.map(d => {
    const i = d.data(); const uid = mapUid(i.userId); if (!uid) return null;
    return {
      id: d.id, user_id: uid, type: i.type, title: i.title, body: i.body, icon: i.icon ?? null,
      severity: i.severity ?? 'info', read: i.read ?? false, dismissed: i.dismissed ?? false,
      created_at: tsToIso(i.createdAt), expires_at: tsToIso(i.expiresAt),
    };
  }));
}

async function migrateInvites() {
  console.log('Invites + org invites');
  const gi = await readCol('invites');
  await upsert('invites', gi.map(d => {
    const v = d.data(); const by = mapUid(v.createdBy); if (!by) return null;
    return {
      token: d.id, group_id: v.groupId, group_name: v.groupName, group_icon: v.groupIcon,
      role: v.role, created_by: by, created_at: tsToIso(v.createdAt), expires_at: tsToIso(v.expiresAt),
      revoked: v.revoked ?? false, max_uses: v.maxUses ?? null, use_count: v.useCount ?? 0,
    };
  }), 'token');
  const oi = await readCol('orgInvites');
  await upsert('org_invites', oi.map(d => {
    const v = d.data(); const by = mapUid(v.createdBy); if (!by) return null;
    return {
      token: d.id, org_id: v.orgId, org_name: v.orgName, org_icon: v.orgIcon,
      role: 'member', created_by: by, created_at: tsToIso(v.createdAt), expires_at: tsToIso(v.expiresAt),
      revoked: v.revoked ?? false, max_uses: v.maxUses ?? null, use_count: v.useCount ?? 0,
    };
  }), 'token');
}

async function migrateSettings() {
  console.log('Settings');
  const docs = await readCol('settings');
  await upsert('settings', docs.map(d => ({ key: d.id, data: deepTs(d.data()) ?? {} })), 'key');
}

// ============================================================
// Run — order respects foreign keys
// ============================================================
(async () => {
  console.log(DRY_RUN ? '=== DRY RUN (no writes) ===' : '=== LIVE MIGRATION ===');
  await migrateUsers();          // profiles
  await migrateCategories();     // → profiles
  await migrateGroups();         // groups + members + group notes/comments
  await migrateOrganizations();  // orgs + members
  await migrateSpaces();         // spaces + members
  await migrateTasks();          // → groups/orgs/spaces
  await migrateNotesUnder('notes', null);   // personal notes + comments
  await migrateDailyReports();   // → groups + notes
  await migrateSchedules();      // → tasks
  await migrateInsights();       // → profiles
  await migrateInvites();        // → groups/orgs
  await migrateSettings();
  console.log('=== DONE ===');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
