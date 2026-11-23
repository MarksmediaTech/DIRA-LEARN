// Edge Function: activates a learner imported from CSV as a participant, right after they set their first password (22 Nov 2026).
// Called by the website (signed in as the learner) from /set-password, and again automatically at sign-in if an earlier
// activation did not finish. It enrols ONLY when all of this holds, otherwise it changes nothing:
//  - the account was imported by programme management: app_metadata.dira_enrolment, written only by import-learners with the
//    service role (users cannot change app_metadata, so a learner cannot mark their own account as imported);
//  - the learner is signed in WITH A PASSWORD (the session's amr claim says "password"), which proves the password is set;
//  - the profile is an active applicant (or already this participant: then it only confirms - running twice is harmless);
//  - the recorded programme track still exists.
// It then creates the participant record (participant number, programme_track_id = the imported track, NO cohort, no
// application), makes the account a participant, opens the portfolio, sends a welcome notification and marks the enrolment
// complete. One participant per account is guaranteed by participants.profile_id being unique.
// Needs the database column participants.programme_track_id (supabase/pending/20261122000001_participant_programme_track.sql).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { withCors } from '../_shared/cors.ts';

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
type Enrolment = { track_id?: string; track_name?: string; invited_by?: string; invited_at?: string; completed_at?: string; participant_id?: string };

/** The session's authentication methods (amr claim) - read only after Supabase Auth has accepted the token (getUser). */
export function signedInWithPassword(authorization: string): boolean {
  try {
    const payload = authorization.replace(/^Bearer\s+/i, '').split('.')[1] ?? '';
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '='))) as { amr?: unknown };
    return Array.isArray(claims.amr) && claims.amr.some((m) => (m as { method?: unknown })?.method === 'password');
  } catch { return false; }
}

Deno.serve(withCors(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!; const authorization = req.headers.get('Authorization') ?? '';
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } });
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: u } = await caller.auth.getUser();          // validates the token with Supabase Auth; returns current app_metadata
  const user = u.user;
  if (!user) return json({ error: 'Not signed in' }, 401);
  const enrolment = (user.app_metadata as { dira_enrolment?: Enrolment } | undefined)?.dira_enrolment;
  if (!enrolment?.track_id) return json({ error: 'This account was not added by a learner import, so it follows the normal application process.' }, 403);
  if (!signedInWithPassword(authorization)) return json({ error: 'Set your password first, then sign in with it.' }, 403);

  const { data: profile } = await admin.from('profiles').select('role, status').eq('id', user.id).single();
  if (!profile) return json({ error: 'Your account profile was not found. Please contact the programme team.' }, 409);
  const { data: existing } = await admin.from('participants').select('id, participant_no').eq('profile_id', user.id).maybeSingle();
  if (profile.role === 'participant' && existing) {
    if (!enrolment.completed_at) await admin.auth.admin.updateUserById(user.id, { app_metadata: { dira_enrolment: { ...enrolment, completed_at: new Date().toISOString(), participant_id: existing.id } } });
    return json({ enrolled: true, already: true, participantNo: existing.participant_no });
  }
  if (profile.status !== 'active') return json({ error: 'Your account is not active. Please contact the programme team.' }, 409);
  if (profile.role !== 'applicant') return json({ error: 'Your account already has another role, so it was not changed. Please contact the programme team.' }, 409);

  const { data: track } = await admin.from('tracks').select('id').eq('id', enrolment.track_id).maybeSingle();
  if (!track) return json({ error: 'The programme track of your import no longer exists. Please contact the programme team.' }, 409);

  let participant = existing as { id: string; participant_no: string } | null;
  if (!participant) {
    const { data: no, error: noErr } = await admin.rpc('next_participant_no');
    if (noErr || !no) { console.error('complete-enrolment: no participant number', noErr?.code ?? 'none'); return json({ error: 'Your participant account could not be created. Please try again.' }, 500); }
    const { data: created, error: insErr } = await admin.from('participants')
      .insert({ profile_id: user.id, participant_no: no, programme_track_id: enrolment.track_id }).select('id, participant_no').single();
    if (insErr || !created) {
      // a second, simultaneous call may have created it: use that one (participants.profile_id is unique)
      const { data: again } = await admin.from('participants').select('id, participant_no').eq('profile_id', user.id).maybeSingle();
      if (!again) { console.error('complete-enrolment: participant insert failed', insErr?.code ?? 'none'); return json({ error: 'Your participant account could not be created. Please try again.' }, 500); }
      participant = again as { id: string; participant_no: string };
    } else participant = created as { id: string; participant_no: string };
  }
  // The participant row exists, so the database allows the applicant -> participant change (service role).
  const { error: roleErr } = await admin.from('profiles').update({ role: 'participant' }).eq('id', user.id);
  if (roleErr) { console.error('complete-enrolment: role change failed', roleErr.code ?? 'none'); return json({ error: 'Your participant account could not be activated. Please try again.' }, 500); }
  const { data: portfolio } = await admin.from('portfolios').select('id').eq('participant_id', participant.id).maybeSingle();
  if (!portfolio) await admin.from('portfolios').insert({ participant_id: participant.id });
  await admin.from('notifications').insert({ user_id: user.id, kind: 'application', title: 'Welcome to DIRA LEARN', body: `You are enrolled in the ${enrolment.track_name ?? 'programme'} track. Your cohort details will follow.` });
  await admin.auth.admin.updateUserById(user.id, { app_metadata: { dira_enrolment: { ...enrolment, completed_at: new Date().toISOString(), participant_id: participant.id } } });
  return json({ enrolled: true, participantNo: participant.participant_no });
}));
