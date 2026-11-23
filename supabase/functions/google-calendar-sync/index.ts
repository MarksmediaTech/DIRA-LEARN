// Edge Function: one-way sync of scheduled DIRA LEARN sessions to ONE organisation Google Calendar (22 Nov 2026). NOT deployed.
// DIRA LEARN is the source of truth: every insert, change, cancellation or deletion of a session schedule is queued by the
// database (gcal_events, see supabase/pending/20261122000002_chat_notifications_calendar.sql); this function works the queue.
// Callers: (1) a scheduler every few minutes with header x-cron-secret = CRON_SECRET; (2) signed-in programme staff or a
// trainer ("Sync now" on the Calendar page). Body {"action":"status"} reports only whether it is configured.
// Google access: a Google Cloud SERVICE ACCOUNT with the Calendar API enabled; the organisation calendar is shared with the
// service account's address ("Make changes to events"). No personal calendar is touched: only GOOGLE_CALENDAR_ID.
// Secrets (server-side only, never in the website): GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY (the private key
// from the service account's JSON key, PEM text), GOOGLE_CALENDAR_ID, CRON_SECRET; optional GOOGLE_CALENDAR_TIMEZONE
// (default Africa/Nairobi). Without them nothing is sent and the queue simply waits; the DIRA LEARN calendar is unaffected.
// Duplicates are impossible: each session has a fixed Google event id ('dira' + its id). A create that finds the id already
// used is turned into an update; deleting an event that is already gone counts as done.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { withCors } from '../_shared/cors.ts';

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
const SYNCERS = ['super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator', 'trainer'];
const API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events';

function equalSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const b64url = (bytes: Uint8Array | string) => {
  const s = typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
/** PEM private key (PKCS#8, as in a Google service-account JSON key) -> CryptoKey for RS256. Accepts "\n" written as text. */
export async function importServiceAccountKey(pem: string): Promise<CryptoKey> {
  const body = pem.replace(/\\n/g, '\n').replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}
/** OAuth 2.0 access token for the service account (JWT bearer grant, RFC 7523). */
export async function googleAccessToken(email: string, key: CryptoKey, now = Math.floor(Date.now() / 1000)): Promise<string> {
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claims}`)));
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${b64url(sig)}` }) });
  const out = await res.json().catch(() => ({})) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !out.access_token) throw new Error(`Google sign-in failed (HTTP ${res.status}${out.error ? ': ' + out.error : ''})`);
  return out.access_token;
}

type Item = { schedule_id: string; google_event_id: string; operation: 'upsert' | 'delete'; title: string | null; description: string | null;
  location: string | null; starts_at: string | null; ends_at: string | null };

async function googleError(res: Response): Promise<string> {
  const b = await res.json().catch(() => null) as { error?: { message?: string } } | null;
  return `Google Calendar answered HTTP ${res.status}${b?.error?.message ? ': ' + String(b.error.message).slice(0, 200) : ''}`;
}

/** Applies one queued change; returns null when done, otherwise the error to record. */
export async function syncOne(it: Item, token: string, calendarId: string, timeZone: string): Promise<string | null> {
  const base = `${API}/calendars/${encodeURIComponent(calendarId)}/events`;
  const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (it.operation === 'delete') {
    const res = await fetch(`${base}/${it.google_event_id}?sendUpdates=none`, { method: 'DELETE', headers: auth });
    return res.ok || res.status === 404 || res.status === 410 ? null : googleError(res);
  }
  if (!it.starts_at || !it.ends_at) return 'The session has no start or end time';
  const event = {
    summary: it.title ?? 'DIRA LEARN session', description: it.description ?? '', location: it.location ?? undefined, status: 'confirmed',
    start: { dateTime: it.starts_at, timeZone }, end: { dateTime: it.ends_at, timeZone },
    extendedProperties: { private: { dira_schedule_id: it.schedule_id } },
  };
  const created = await fetch(`${base}?sendUpdates=none`, { method: 'POST', headers: auth, body: JSON.stringify({ id: it.google_event_id, ...event }) });
  if (created.ok) return null;
  if (created.status !== 409) return googleError(created);
  // the id exists already (an earlier create, or a cancelled event): update it instead - never a second event
  const updated = await fetch(`${base}/${it.google_event_id}?sendUpdates=none`, { method: 'PATCH', headers: auth, body: JSON.stringify(event) });
  return updated.ok ? null : googleError(updated);
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
      allowed = Boolean(me && me.status === 'active' && SYNCERS.includes(me.role));
    }
  }
  if (!allowed) return json({ error: 'Forbidden' }, 403);

  const email = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL'); const pem = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_KEY');
  const calendarId = Deno.env.get('GOOGLE_CALENDAR_ID'); const timeZone = Deno.env.get('GOOGLE_CALENDAR_TIMEZONE') || 'Africa/Nairobi';
  const configured = Boolean(email && pem && calendarId);
  const body = await req.json().catch(() => ({})) as { action?: string };
  if (body.action === 'status') return json({ configured });
  if (!configured) return json({ error: 'Google Calendar sync is not set up yet (GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY, GOOGLE_CALENDAR_ID). The DIRA LEARN calendar works without it; changes wait in the queue.' }, 503);

  const { data: items, error: claimErr } = await admin.rpc('gcal_claim', { p_limit: 20 });
  if (claimErr) { console.error('google-calendar-sync: claim failed', claimErr.code ?? ''); return json({ error: 'Could not read the sync queue.' }, 500); }
  const list = (items ?? []) as Item[];
  if (!list.length) return json({ processed: 0, synced: 0, failed: 0 });

  let token: string;
  try { token = await googleAccessToken(email!, await importServiceAccountKey(pem!)); }
  catch (e) {
    const msg = e instanceof Error ? e.message : 'Google sign-in failed';
    for (const it of list) await admin.rpc('gcal_record', { p_schedule: it.schedule_id, p_ok: false, p_error: msg });
    return json({ error: msg, processed: list.length, synced: 0, failed: list.length }, 502);
  }
  let synced = 0; let failed = 0;
  for (const it of list) {
    let problem: string | null;
    try { problem = await syncOne(it, token, calendarId!, timeZone); } catch { problem = 'Google Calendar could not be reached'; }
    await admin.rpc('gcal_record', { p_schedule: it.schedule_id, p_ok: problem === null, p_error: problem });
    if (problem === null) synced++; else failed++;
  }
  return json({ processed: list.length, synced, failed });
}));
