// Edge Function: deactivate or reactivate an account (post-audit fix M1, 20 Nov 2026). NOT deployed.
// 1. admin_set_account_status() runs with the CALLER's session, so the database itself checks that the caller is an active
//    super administrator, that a reason is given, that it is not their own account; it records the change.
//    From that moment every request of the deactivated person is refused (migration 34), including sessions already open.
// 2. With the service role, the Supabase Auth account is banned (deactivation) or the ban is lifted (reactivation), so the
//    person cannot sign in again. Nothing is deleted.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { withCors } from '../_shared/cors.ts';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BAN = '876000h';   // about 100 years; lifted with 'none' on reactivation

Deno.serve(withCors(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!;
  const auth = req.headers.get('Authorization') ?? '';
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: userData } = await caller.auth.getUser();
  if (!userData.user) return json({ error: 'Not signed in' }, 401);

  const { userId, status, reason } = await req.json().catch(() => ({}));
  if (typeof userId !== 'string' || !UUID.test(userId)) return json({ error: 'userId required' }, 400);
  if (status !== 'active' && status !== 'deactivated') return json({ error: 'status must be active or deactivated' }, 400);
  if (typeof reason !== 'string') return json({ error: 'A reason is required' }, 400);

  // The database decides whether this caller may do it (and records it). Its refusal messages are written for users.
  const { data: eventId, error } = await caller.rpc('admin_set_account_status', { p_profile: userId, p_status: status, p_reason: reason });
  if (error) return json({ error: error.code === '42501' ? 'Only a super administrator can deactivate or reactivate accounts' : error.message }, error.code === '42501' ? 403 : 400);

  const { error: banErr } = await admin.auth.admin.updateUserById(userId, { ban_duration: status === 'deactivated' ? BAN : 'none' });
  await admin.from('account_status_events').update({ sign_in_blocked: status === 'deactivated' ? !banErr : false }).eq('id', eventId);
  if (banErr) {
    console.error('set-account-status: auth ban update failed', banErr.status);
    return json({ eventId, status, signInUpdated: false,
      warning: status === 'deactivated'
        ? 'The account is deactivated and has no access, but Supabase could not block sign-in. Try again, or ban the user in Supabase > Authentication.'
        : 'The account is active again, but Supabase could not lift the sign-in block. Try again, or unban the user in Supabase > Authentication.' });
  }
  return json({ eventId, status, signInUpdated: true });
}));
