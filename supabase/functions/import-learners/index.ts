// Edge Function: programme management adds learners for DIRA LEARN direct enrolment (22 Nov 2026): from a CSV file, or one at a
// time with the Add learner form (one row, fileName 'Added on the dashboard') - the same checks, invitation and activation.
// Each row has exactly name, email, programme_track. Every learner gets an invitation email (sent by Supabase Auth, so Auth SMTP
// must be configured: the built-in sender allows only a handful of emails per hour) with a link to /set-password. The matched
// programme track is recorded in the account's app_metadata (dira_enrolment) - a part of the account only the server can write,
// so nobody can mark their own account as imported. When the learner has set a password and signs in with it, the Edge Function
// complete-enrolment makes them an active participant with that track and no cohort. No application form, no approval.
// Public applicants are not affected. Accounts that already exist are not changed (reported as "already registered").
// Secrets: SUPABASE_SERVICE_ROLE_KEY (provided by Supabase) and APP_URL (your public app address).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { withCors } from '../_shared/cors.ts';

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const MANAGERS = ['super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator'];
const MAX_ROWS = 200;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// eslint-disable-next-line no-control-regex -- removes control characters that spreadsheets leave in cells
const clean = (s: unknown) => String(s ?? '').replace(/[\u0000-\u001F\u007F]/g, '').replace(/\s+/g, ' ').trim();
const normTrack = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

Deno.serve(withCors(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!; const appUrl = Deno.env.get('APP_URL');
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  const { data: u } = await caller.auth.getUser();
  if (!u.user) return json({ error: 'Not signed in' }, 401);
  const { data: me } = await admin.from('profiles').select('role, status').eq('id', u.user.id).single();
  if (!me || me.status !== 'active' || !MANAGERS.includes(me.role)) return json({ error: 'Forbidden' }, 403);
  if (!appUrl) return json({ error: 'APP_URL is not set for this function, so invitation links would not work.' }, 503);

  const body = await req.json().catch(() => null) as { fileName?: string; rows?: { name?: string; email?: string; programme_track?: string }[] } | null;
  if (!body || !Array.isArray(body.rows) || !body.rows.length) return json({ error: 'No learners supplied' }, 400);
  if (body.rows.length > MAX_ROWS) return json({ error: `At most ${MAX_ROWS} learners per file` }, 400);

  // The programme tracks configured in DIRA LEARN. Nothing else is accepted, and none is created.
  const { data: trackRows, error: tErr } = await admin.from('tracks').select('id, name');
  if (tErr || !Array.isArray(trackRows) || !trackRows.length) return json({ error: 'The programme tracks could not be read, so no learner was imported.' }, 500);
  const tracks = new Map((trackRows as { id: string; name: string }[]).map((t) => [normTrack(t.name), t]));

  // Validate again here: the browser check is a convenience, this one is the rule.
  const seen = new Set<string>();
  const items = body.rows.map((r, i) => {
    const email = clean(r.email).toLowerCase(); const name = clean(r.name); const trackText = clean(r.programme_track);
    const track = tracks.get(normTrack(trackText)) ?? null;
    let error: string | null = null;
    if (!name || name.length > 160) error = 'Invalid name';
    else if (!EMAIL.test(email) || email.length > 254) error = 'Invalid email';
    else if (seen.has(email)) error = 'Duplicate email in file';
    else if (!track) error = 'Unknown programme track';
    seen.add(email);
    return { rowNo: i + 2, email, name, track, error };
  });

  const results: { rowNo: number; email: string; outcome: 'invited' | 'already_registered' | 'failed'; message: string | null }[] = [];
  for (const it of items) {
    if (it.error || !it.track) { results.push({ rowNo: it.rowNo, email: it.email, outcome: 'failed', message: it.error }); continue; }
    const { data, error } = await admin.auth.admin.inviteUserByEmail(it.email, { redirectTo: `${appUrl.replace(/\/$/, '')}/set-password` });
    if (error || !data.user) {
      const already = (error as { code?: string } | null)?.code === 'email_exists' || /already|registered|exists/i.test(error?.message ?? '');
      results.push({ rowNo: it.rowNo, email: it.email, outcome: already ? 'already_registered' : 'failed', message: already ? null : /rate limit|too many/i.test(error?.message ?? '') ? 'Email sending limit reached: try again later (set up Auth SMTP for larger imports)' : 'The invitation could not be sent' });
      if (!already) console.error('import-learners: invitation failed', (error as { code?: string } | null)?.code ?? 'unknown');
      continue;
    }
    // An account that has already been activated is never changed by an import.
    if ((data.user.app_metadata as { dira_enrolment?: { completed_at?: string } } | undefined)?.dira_enrolment?.completed_at) {
      results.push({ rowNo: it.rowNo, email: it.email, outcome: 'already_registered', message: null }); continue;
    }
    // Invited before but not activated yet: the invitation was sent again (Supabase re-sends to accounts not yet confirmed);
    // the track is updated to this row's track. Reported so staff know it is not a new account.
    const again = Boolean((data.user.app_metadata as { dira_enrolment?: unknown } | undefined)?.dira_enrolment);
    // Server-only record of the direct enrolment: which track, who imported, when. Users cannot change app_metadata.
    const { error: mErr } = await admin.auth.admin.updateUserById(data.user.id, {
      app_metadata: { dira_enrolment: { track_id: it.track.id, track_name: it.track.name, invited_by: u.user.id, invited_at: new Date().toISOString() } },
    });
    if (mErr) {
      console.error('import-learners: enrolment details not saved', (mErr as { code?: string }).code ?? 'unknown');
      results.push({ rowNo: it.rowNo, email: it.email, outcome: 'failed', message: 'Invitation email sent, but the programme track could not be saved: import this learner again' });
      continue;
    }
    // The profile row is created by the sign-up trigger as an applicant; only the names are filled in here.
    // The complete name is kept whole (22 Nov 2026 correction): it is never split into first and last name. The existing profile
    // columns are kept, so the whole name sits in first_name and last_name stays empty; every screen already shows both together.
    await admin.from('profiles').update({ first_name: it.name, last_name: '' }).eq('id', data.user.id);
    results.push({ rowNo: it.rowNo, email: it.email, outcome: 'invited', message: again ? 'Already invited earlier, not yet activated' : null });
  }

  const count = (o: string) => results.filter((r) => r.outcome === o).length;
  const { data: batch, error: bErr } = await admin.from('import_batches').insert({ created_by: u.user.id, file_name: clean(body.fileName).slice(0, 200) || null, total: results.length, invited: count('invited'), already_registered: count('already_registered'), failed: count('failed') }).select('id').single();
  if (!bErr && batch) {
    const byRow = new Map(items.map((i) => [i.rowNo, i]));
    await admin.from('import_rows').insert(results.map((r) => ({ batch_id: batch.id, row_no: r.rowNo, email: r.email, first_name: byRow.get(r.rowNo)?.name ?? null, last_name: null, outcome: r.outcome, message: r.message })));
  }
  return json({ batchId: batch?.id ?? null, invited: count('invited'), alreadyRegistered: count('already_registered'), failed: count('failed'), rows: results });
}));
