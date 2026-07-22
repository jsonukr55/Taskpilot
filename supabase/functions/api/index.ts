// ============================================================
// TaskPilot API — membership Edge Function (Supabase / Deno)
//
// One function, internal router. Replaces the old Firebase functions for
// server-side membership writes that RLS forbids from the client:
//   POST .../functions/v1/api/joinGroup      { token }
//   POST .../functions/v1/api/joinOrg        { token }
//   POST .../functions/v1/api/addOrgMember   { orgId, email }
//   POST .../functions/v1/api/setGlobalRole  { email, role }
//
// Auth is verified INSIDE the function (verify_jwt disabled) so the browser
// CORS preflight (OPTIONS, no Authorization header) isn't rejected by the
// gateway. Privileged DB writes use the service-role key (bypasses RLS; also
// satisfies the guard_global_role trigger which only trusts service_role).
// ------------------------------------------------------------
// AZURE PORTABILITY: the business logic (joinGroup/joinOrg/addOrgMember/
// setGlobalRole) is plain async fns over standard Postgres via supabase-js,
// which also runs on Node. To move to Azure Functions, only the runtime glue
// changes — everything below the handlers stays identical:
//   1. import  'jsr:@supabase/supabase-js@2'  →  '@supabase/supabase-js' (npm)
//   2. Deno.env.get('X')                      →  process.env.X
//   3. Deno.serve(handler)                    →  Azure Functions HTTP trigger
//      (extract token from req, call the same switch, return the same JSON)
// No SQL, RLS, or logic changes. (supabase-js talks to any Postgres/GoTrue,
// self-hosted on Azure or managed.)
// ============================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Emails allowed to self-promote to the FIRST admin (bootstrap).
const BOOTSTRAP_ADMIN_EMAILS = ['linkmanishgupta@gmail.com', 'jsonukr55.sg@gmail.com'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function callerFrom(req: Request) {
  const header = req.headers.get('Authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  const { data, error } = await admin.auth.getUser(token);
  return error ? null : data.user;
}

async function profileOf(uid: string) {
  const { data } = await admin.from('profiles').select('display_name, photo_url').eq('id', uid).maybeSingle();
  return { displayName: data?.display_name ?? 'Member', photoURL: data?.photo_url ?? null };
}

const expired = (iso: string | null) => !!iso && new Date(iso).getTime() < Date.now();

// ---- joinGroup -------------------------------------------------------
async function joinGroup(user: { id: string }, body: any): Promise<Response> {
  const token = body?.token;
  if (!token) return json({ error: 'token required' }, 400);

  const { data: inv } = await admin.from('invites').select('*').eq('token', token).maybeSingle();
  if (!inv)                                             return json({ error: 'This invite link is invalid.' }, 404);
  if (inv.revoked)                                      return json({ error: 'This invite has been revoked.' }, 409);
  if (expired(inv.expires_at))                          return json({ error: 'This invite link has expired.' }, 409);
  if (inv.max_uses != null && inv.use_count >= inv.max_uses) return json({ error: 'This invite link has already been used.' }, 409);

  const { data: group } = await admin.from('groups').select('id, name, icon').eq('id', inv.group_id).maybeSingle();
  if (!group) return json({ error: 'That group no longer exists.' }, 404);

  const { data: existing } = await admin.from('group_members')
    .select('role').eq('group_id', group.id).eq('user_id', user.id).maybeSingle();
  const alreadyMember = !!existing;

  if (!alreadyMember) {
    const p = await profileOf(user.id);
    await admin.from('group_members').insert({
      group_id: group.id, user_id: user.id, role: inv.role,
      display_name: p.displayName, photo_url: p.photoURL,
    });
    await admin.from('invites').update({ use_count: (inv.use_count ?? 0) + 1 }).eq('token', token);
  }

  const { count } = await admin.from('group_members').select('*', { count: 'exact', head: true }).eq('group_id', group.id);
  return json({
    groupId: group.id, groupName: group.name, groupIcon: group.icon,
    role: alreadyMember ? (existing!.role ?? inv.role) : inv.role,
    memberCount: count ?? 0, alreadyMember,
  });
}

// ---- joinOrg ---------------------------------------------------------
async function joinOrg(user: { id: string }, body: any): Promise<Response> {
  const token = body?.token;
  if (!token) return json({ error: 'token required' }, 400);

  const { data: inv } = await admin.from('org_invites').select('*').eq('token', token).maybeSingle();
  if (!inv)                                             return json({ error: 'This invite link is invalid.' }, 404);
  if (inv.revoked)                                      return json({ error: 'This invite has been revoked.' }, 409);
  if (expired(inv.expires_at))                          return json({ error: 'This invite link has expired.' }, 409);
  if (inv.max_uses != null && inv.use_count >= inv.max_uses) return json({ error: 'This invite link has already been used.' }, 409);

  const { data: org } = await admin.from('organizations').select('id, name, icon').eq('id', inv.org_id).maybeSingle();
  if (!org) return json({ error: 'That organization no longer exists.' }, 404);

  const { data: existing } = await admin.from('org_members')
    .select('user_id').eq('org_id', org.id).eq('user_id', user.id).maybeSingle();
  const alreadyMember = !!existing;

  if (!alreadyMember) {
    const p = await profileOf(user.id);
    await admin.from('org_members').insert({
      org_id: org.id, user_id: user.id, role: 'member',
      display_name: p.displayName, photo_url: p.photoURL,
    });
    await admin.from('org_invites').update({ use_count: (inv.use_count ?? 0) + 1 }).eq('token', token);
  }

  const { count } = await admin.from('org_members').select('*', { count: 'exact', head: true }).eq('org_id', org.id);
  return json({
    orgId: org.id, orgName: org.name, orgIcon: org.icon, role: 'member',
    memberCount: count ?? 0, alreadyMember,
  });
}

// ---- addOrgMember (owner/admin adds an existing user by email) -------
async function addOrgMember(user: { id: string }, body: any): Promise<Response> {
  const orgId = body?.orgId;
  const email = (body?.email ?? '').trim();
  if (!orgId || !email) return json({ error: 'orgId and email required' }, 400);

  const { data: target } = await admin.from('profiles')
    .select('id, display_name, photo_url').ilike('email', email).maybeSingle();
  if (!target) return json({ error: 'No account found for that email. Send them an invite link instead.' }, 404);

  const { data: org } = await admin.from('organizations').select('id, owner_id').eq('id', orgId).maybeSingle();
  if (!org) return json({ error: 'Organization not found.' }, 404);

  const { data: caller } = await admin.from('profiles').select('global_role').eq('id', user.id).maybeSingle();
  const callerAdmin = caller?.global_role === 'admin';
  if (org.owner_id !== user.id && !callerAdmin) {
    return json({ error: 'Only the org owner or an admin can add members.' }, 403);
  }

  const { data: existing } = await admin.from('org_members')
    .select('user_id').eq('org_id', orgId).eq('user_id', target.id).maybeSingle();
  const alreadyMember = !!existing;
  if (!alreadyMember) {
    await admin.from('org_members').insert({
      org_id: orgId, user_id: target.id, role: 'member',
      display_name: target.display_name ?? 'Member', photo_url: target.photo_url ?? null,
    });
  }
  return json({ uid: target.id, displayName: target.display_name ?? 'Member', alreadyMember });
}

// ---- setGlobalRole (bootstrap email or existing admin) ---------------
async function setGlobalRole(user: { id: string; email?: string }, body: any): Promise<Response> {
  const email = (body?.email ?? '').trim();
  const role: 'admin' | null = body?.role === 'admin' ? 'admin' : null;
  if (!email) return json({ error: 'email required' }, 400);

  const callerEmail = (user.email ?? '').toLowerCase();
  const bootstrap = BOOTSTRAP_ADMIN_EMAILS.map(e => e.toLowerCase()).includes(callerEmail);
  if (!bootstrap) {
    const { data: caller } = await admin.from('profiles').select('global_role').eq('id', user.id).maybeSingle();
    if (caller?.global_role !== 'admin') return json({ error: 'Only an admin can change roles.' }, 403);
  }

  const { data: target } = await admin.from('profiles').select('id, global_role').ilike('email', email).maybeSingle();
  if (!target) return json({ error: 'No account found for that email.' }, 404);

  if (role === null) {
    const { count } = await admin.from('profiles').select('*', { count: 'exact', head: true }).eq('global_role', 'admin');
    if ((count ?? 0) <= 1 && target.global_role === 'admin') {
      return json({ error: "Can't remove the last admin." }, 409);
    }
  }

  // service_role satisfies the guard_global_role trigger.
  const { error } = await admin.from('profiles').update({ global_role: role }).eq('id', target.id);
  if (error) return json({ error: error.message }, 500);
  return json({ uid: target.id, email, role });
}

// ---- Router ----------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const route = new URL(req.url).pathname.split('/').filter(Boolean).pop();

  const user = await callerFrom(req);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body ok */ }

  try {
    switch (route) {
      case 'joinGroup':     return await joinGroup(user, body);
      case 'joinOrg':       return await joinOrg(user, body);
      case 'addOrgMember':  return await addOrgMember(user, body);
      case 'setGlobalRole': return await setGlobalRole(user, body);
      default:              return json({ error: `Unknown route: ${route}` }, 404);
    }
  } catch (e) {
    console.error('[api]', route, e);
    return json({ error: (e as Error)?.message ?? 'Server error' }, 500);
  }
});
