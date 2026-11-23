// Edge Function: queue reminders, then send queued emails through Resend. NOT deployed or tested.
// Callers: (1) a scheduler with header x-cron-secret = CRON_SECRET, (2) a signed-in programme manager (Send now button).
// Secrets live only in the function environment: RESEND_API_KEY, EMAIL_FROM, CRON_SECRET, optional APP_URL.
// Nothing is sent, and no success is reported, unless the provider accepts the message.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { withCors } from '../_shared/cors.ts';
import { wrapLayout } from '../_shared/layout.ts';

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const MANAGERS = ['super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator'];

function equalSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(withCors(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  let allowed = equalSecret(req.headers.get('x-cron-secret') ?? '', Deno.env.get('CRON_SECRET') ?? '');
  if (!allowed) {
    const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: u } = await caller.auth.getUser();
    if (u.user) {
      const { data: me } = await admin.from('profiles').select('role, status').eq('id', u.user.id).single();
      allowed = Boolean(me && me.status === 'active' && MANAGERS.includes(me.role));
    }
  }
  if (!allowed) return json({ error: 'Forbidden' }, 403);

  const body = await req.json().catch(() => ({}));
  const apiKey = Deno.env.get('RESEND_API_KEY'); const from = Deno.env.get('EMAIL_FROM');
  const configured = Boolean(apiKey && from);
  if (body.action === 'status') return json({ configured, cronSecretSet: Boolean(Deno.env.get('CRON_SECRET')) });

  // Housekeeping that must run even without an email provider (migrations 24 and 25).
  // 1. Safeguarding concerns past their acknowledgement target alert both officers (in-app; email only if configured).
  const { data: overdue, error: sgErr } = await admin.rpc('sg_overdue_check');
  if (sgErr) return json({ error: sgErr.message }, 500);
  // 2. DIRA Connect retention. Does nothing unless an executive has switched retention ON; never touches safeguarding
  //    conversations, reported or safeguarding-linked conversations, or anything under a legal hold.
  const { data: purged, error: rErr } = await admin.rpc('connect_retention_purge');
  if (rErr) return json({ error: rErr.message }, 500);
  const paths = ((purged ?? []) as { storage_path: string }[]).map((p) => p.storage_path).filter(Boolean);
  let filesRemoved = 0;
  for (let i = 0; i < paths.length; i += 100) {
    const { data: removed } = await admin.storage.from('connect-attachments').remove(paths.slice(i, i + 100));
    filesRemoved += removed?.length ?? 0;
  }

  // 3. Daily performance snapshot for each learner in running cohorts (migration 27; at most once a day).
  const { error: pErr } = await admin.rpc('take_progress_snapshots');
  if (pErr) return json({ error: pErr.message }, 500);

  if (!configured) return json({ error: 'Email provider is not configured. Set RESEND_API_KEY and EMAIL_FROM as function secrets.', safeguardingOverdue: overdue ?? 0, filesRemoved }, 503);

  await admin.rpc('requeue_stuck_emails');
  const { data: queued, error: qErr } = await admin.rpc('queue_reminders');
  if (qErr) return json({ error: qErr.message }, 500);
  const { error: bErr } = await admin.rpc('publish_due_briefs');   // scheduled Daily Briefs (migration 21)
  if (bErr) return json({ error: bErr.message }, 500);
  const { error: aErr } = await admin.rpc('queue_access_reminders');   // learning-access reminders (migration 19)
  if (aErr) return json({ error: aErr.message }, 500);
  const { data: batch, error: cErr } = await admin.rpc('claim_emails', { p_limit: 25 });
  if (cErr) return json({ error: cErr.message }, 500);

  let sent = 0; let failed = 0;
  for (const m of batch ?? []) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': m.id },
        body: JSON.stringify({ from, to: [m.to_email], subject: m.subject, text: m.body, html: wrapLayout(m.subject, m.body, Deno.env.get('APP_URL')) }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.id) throw new Error(out.message ?? `Provider returned ${res.status}`);
      await admin.from('email_outbox').update({ status: 'sent', provider_id: out.id, sent_at: new Date().toISOString(), error: null }).eq('id', m.id);
      sent++;
    } catch (e) {
      const final = m.attempts >= 3;
      await admin.from('email_outbox').update({ status: final ? 'failed' : 'queued', error: String((e as Error).message).slice(0, 500) }).eq('id', m.id);
      failed++;
    }
  }
  return json({ remindersQueued: queued ?? 0, claimed: (batch ?? []).length, sent, failed, safeguardingOverdue: overdue ?? 0, filesRemoved });
}));
