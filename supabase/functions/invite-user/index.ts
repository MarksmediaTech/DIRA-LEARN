// Edge Function: a super administrator invites a staff member by email. Needs the service-role key, which exists only
// in the function environment. NOT deployed or tested. Participants cannot be created here (they come from applications).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { withCors } from '../_shared/cors.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const ROLES = ['super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator', 'trainer', 'me_officer', 'mentor'];

Deno.serve(withCors(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!;
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: userData } = await caller.auth.getUser();
  if (!userData.user) return json({ error: 'Not signed in' }, 401);
  const { data: me } = await admin.from('profiles').select('role, status').eq('id', userData.user.id).single();
  if (!me || me.status !== 'active' || me.role !== 'super_admin') return json({ error: 'Forbidden' }, 403);

  const { email, role } = await req.json().catch(() => ({}));
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'A valid email is required' }, 400);
  if (typeof role !== 'string' || !ROLES.includes(role)) return json({ error: 'Invalid role' }, 400);

  const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(email.trim());
  if (error || !invited.user) return json({ error: error?.message ?? 'Invitation failed' }, 400);
  const { error: upErr } = await admin.from('profiles').update({ role, status: 'active' }).eq('id', invited.user.id);
  if (upErr) return json({ error: upErr.message }, 500);
  return json({ userId: invited.user.id });
}));
