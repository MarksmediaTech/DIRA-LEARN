// Edge Function: turn an ACCEPTED application into a participant record. Needs the service-role key,
// which exists only in the function environment (never in frontend code). Deploy only with approval.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { withCors } from '../_shared/cors.ts';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(withCors(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!;
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: userData } = await caller.auth.getUser();
  if (!userData.user) return json({ error: 'Not signed in' }, 401);
  const { data: me } = await admin.from('profiles').select('role, status').eq('id', userData.user.id).single();
  if (!me || me.status !== 'active' || !['super_admin', 'founder', 'co_founder', 'programme_coordinator'].includes(me.role)) return json({ error: 'Forbidden' }, 403);

  const { applicationId } = await req.json().catch(() => ({}));
  if (typeof applicationId !== 'string') return json({ error: 'applicationId required' }, 400);

  const { data: app } = await admin.from('applications').select('id, applicant_id, status, form_data').eq('id', applicationId).single();
  if (!app) return json({ error: 'Application not found' }, 404);
  if (app.status !== 'accepted') return json({ error: 'Only accepted applications can be converted' }, 409);

  const { data: existing } = await admin.from('participants').select('id').eq('application_id', app.id).maybeSingle();
  if (existing) return json({ participantId: existing.id, alreadyConverted: true });

  const { data: no } = await admin.rpc('next_participant_no');
  const f = (app.form_data ?? {}) as Record<string, string>;
  const { data: participant, error } = await admin.from('participants')
    .insert({ profile_id: app.applicant_id, application_id: app.id, participant_no: no, date_of_birth: f.dateOfBirth ?? null }).select('id').single();
  if (error) { console.error('convert-application: participant insert failed', error.code); return json({ error: 'Could not create the participant record' }, 500); }

  await admin.from('profiles').update({ role: 'participant', first_name: f.firstName ?? '', last_name: f.lastName ?? '', phone: f.phone ?? null }).eq('id', app.applicant_id);
  await admin.from('portfolios').insert({ participant_id: participant.id });
  await admin.from('notifications').insert({ user_id: app.applicant_id, kind: 'application', title: 'Your application was accepted', body: 'Welcome to DIRA LEARN. Your cohort details will follow.' });
  return json({ participantId: participant.id });
}));
