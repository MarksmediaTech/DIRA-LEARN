// Real-browser test of the browser-called Edge Functions (post-audit fix H2): the REAL function code (bundled by build.mjs)
// runs in Node behind a local HTTP server; Supabase itself is SIMULATED (fake-supabase.mjs). Chrome loads a page from an
// allowed origin and from a non-allowed origin and calls each function the way supabase-js does (Authorization, apikey,
// x-client-info, JSON body), which triggers the browser's CORS preflight. Usage: node run.mjs <project>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const proj = path.resolve(process.argv[2]); const here = path.dirname(new URL(import.meta.url).pathname);
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'edge-fn-'));
execFileSync('node', [path.join(here, 'build.mjs'), proj, out], { stdio: 'inherit' });
const listen = (srv) => new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv.address().port)));
const page = () => http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end('<!doctype html><title>t</title>'); });
const portA = await listen(page()); const portB = await listen(page());
const A = `http://127.0.0.1:${portA}`; const B = `http://127.0.0.1:${portB}`;

const ENV = { SUPABASE_URL: 'http://fake.supabase', SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-role-key', APP_URL: A,
              ALLOWED_ORIGINS: 'https://release-preview.dira-learn.pages.dev', SETUP_CODE: 'correct-setup-code-123456', FIRST_ADMIN_EMAIL: 'marksmedia.studios@gmail.com', CRON_SECRET: 'cron-secret-0123456789' };
globalThis.__calls = [];
globalThis.__fx = {
  tokens: { 'tok-admin': 'u-admin', 'tok-coord': 'u-coord', 'tok-learner': 'u-learner', 'tok-applicant': 'u-app', 'tok-deact': 'u-deact' },
  profiles: { 'u-admin': { role: 'super_admin', status: 'active' }, 'u-coord': { role: 'programme_coordinator', status: 'active' },
              'u-learner': { role: 'participant', status: 'active' }, 'u-app': { role: 'applicant', status: 'active' }, 'u-deact': { role: 'super_admin', status: 'deactivated' } },
  application: { id: 'app-1', applicant_id: 'u-app', status: 'accepted', form_data: {} },
  tracks: [{ id: 't-dm', name: 'Digital Marketing' }, { id: 't-ai', name: 'AI Tools' }, { id: 't-cc', name: 'Content Creation' }, { id: 't-eb', name: 'Entrepreneurship & Business' }],
};
const handlers = {}; let current = '';
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: (h) => { handlers[current] = h; } };
for (const f of ['invite-user', 'import-learners', 'convert-application', 'bootstrap-first-admin', 'send-emails', 'set-account-status', 'scan-attachments', 'complete-enrolment', 'google-calendar-sync']) { current = f; await import(path.join(out, f + '.mjs')); }

const log = [];
const fnServer = http.createServer(async (q, r) => {
  const name = q.url.split('/').pop(); const chunks = []; for await (const c of q) chunks.push(c);
  const req = new Request('http://fn' + q.url, { method: q.method, headers: q.headers, body: ['GET', 'HEAD', 'OPTIONS'].includes(q.method) ? undefined : Buffer.concat(chunks) });
  const before = globalThis.__calls.length;
  const res = await handlers[name](req);
  log.push({ name, method: q.method, origin: q.headers.origin ?? null, status: res.status, ran: globalThis.__calls.length > before, acao: res.headers.get('access-control-allow-origin') });
  r.writeHead(res.status, Object.fromEntries(res.headers)); r.end(Buffer.from(await res.arrayBuffer()));
});
const F = `http://127.0.0.1:${await listen(fnServer)}/functions/v1/`;

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext();
const pA = await ctx.newPage(); await pA.goto(A); const pB = await ctx.newPage(); await pB.goto(B);
const invoke = (p, name, token, body) => p.evaluate(async ([url, token, body]) => {
  const headers = { apikey: 'anon-key', 'x-client-info': 'supabase-js-web/2.45.0', 'content-type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  try { const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
        return { status: r.status, acao: r.headers.get('access-control-allow-origin'), body: await r.json().catch(() => null) }; }
  catch (e) { return { blocked: true, error: String(e) }; }
}, [F + name, token, body]);

const results = [];
async function check(label, fn) { try { const why = await fn(); results.push([label, true, why ?? '']); } catch (e) { results.push([label, false, String(e.message ?? e)]); } }
// The page itself cannot read Access-Control-Allow-Origin (not an exposed header); the server log shows what was sent.
// That the page could read the status and body at all proves the browser accepted the CORS response.
const expectStatus = (r, s) => { if (r.blocked) throw new Error('blocked by the browser: ' + r.error); if (r.status !== s) throw new Error(`status ${r.status} ${JSON.stringify(r.body)}`);
  const sent = log.at(-1); if (sent.acao !== A) throw new Error('Access-Control-Allow-Origin sent = ' + sent.acao);
  // Chrome caches a successful preflight (Access-Control-Max-Age 600), so only the first call per function sends one.
  if (!log.some((x) => x.name === sent.name && x.method === 'OPTIONS' && x.status === 204 && x.origin === A)) throw new Error('no successful preflight for ' + sent.name);
  return `HTTP ${r.status} after preflight 204, allow-origin = this site only`; };

const CASES = [
  ['invite-user', 'tok-admin', { email: 'new.staff@example.org', role: 'trainer' }, 200, 'staff invitation by a super administrator'],
  ['invite-user', 'tok-coord', { email: 'x@example.org', role: 'trainer' }, 403, 'staff invitation refused for a coordinator'],
  ['invite-user', null, { email: 'x@example.org', role: 'trainer' }, 401, 'staff invitation refused when signed out'],
  ['import-learners', 'tok-coord', { fileName: 'l.csv', rows: [{ name: 'Ann One', email: 'ann@example.org', programme_track: 'AI Tools' }] }, 200, 'learner import by programme management'],
  ['import-learners', 'tok-learner', { rows: [{ name: 'A B', email: 'a@example.org', programme_track: 'AI Tools' }] }, 403, 'learner import refused for a learner'],
  ['convert-application', 'tok-coord', { applicationId: 'app-1' }, 200, 'accepted applicant conversion by a coordinator'],
  ['convert-application', 'tok-learner', { applicationId: 'app-1' }, 403, 'applicant conversion refused for a learner'],
  ['send-emails', 'tok-coord', { action: 'status' }, 200, 'email status for programme management'],
  ['send-emails', 'tok-coord', { action: 'run' }, 503, 'email Send now runs housekeeping, then reports the missing provider (503)'],
  ['send-emails', 'tok-learner', { action: 'run' }, 403, 'email sending refused for a learner'],
  ['send-emails', 'tok-deact', { action: 'run' }, 403, 'email sending refused for a deactivated super administrator'],
  ['set-account-status', 'tok-admin', { userId: '34340000-0000-0000-0000-000000000005', status: 'deactivated', reason: 'Contract ended in November' }, 200, 'deactivation by a super administrator'],
  ['set-account-status', 'tok-coord', { userId: '34340000-0000-0000-0000-000000000005', status: 'deactivated', reason: 'Coordinator attempt here' }, 403, 'deactivation refused for a coordinator'],
  ['set-account-status', 'tok-deact', { userId: '34340000-0000-0000-0000-000000000005', status: 'active', reason: 'Deactivated admin attempt' }, 403, 'reactivation refused for a deactivated super administrator'],
];
for (const [name, tok, body, status, label] of CASES) await check(`${name}: ${label}`, async () => expectStatus(await invoke(pA, name, tok, body), status));

await check('set-account-status: deactivation bans the Supabase Auth user (sign-in blocked)', async () => {
  const c = globalThis.__calls.filter((x) => x.kind === 'updateUserById' && 'ban_duration' in x.attrs); if (c.length !== 1 || c[0].attrs.ban_duration !== '876000h') throw new Error(JSON.stringify(c)); return 'ban_duration 876000h';
});
await check('set-account-status: the database rule runs with the caller\'s own session, not the service role', async () => {
  const c = globalThis.__calls.filter((x) => x.kind === 'rpc' && x.name === 'admin_set_account_status'); if (!c.length || c.some((x) => x.key !== 'caller')) throw new Error(JSON.stringify(c)); return `${c.length} calls, all as caller`;
});
await check('set-account-status: reactivation lifts the ban', async () => {
  expectStatus(await invoke(pA, 'set-account-status', 'tok-admin', { userId: '34340000-0000-0000-0000-000000000005', status: 'active', reason: 'Back for the next intake' }), 200);
  const c = globalThis.__calls.filter((x) => x.kind === 'updateUserById').at(-1); if (c.attrs.ban_duration !== 'none') throw new Error(JSON.stringify(c)); return "ban_duration 'none'";
});

for (const name of ['invite-user', 'import-learners', 'convert-application', 'bootstrap-first-admin', 'send-emails', 'set-account-status', 'complete-enrolment', 'google-calendar-sync']) {
  await check(`${name}: a page on another website is blocked by the browser and the function never runs`, async () => {
    const n = log.length; const r = await invoke(pB, name, 'tok-admin', { action: 'status' });
    if (!r.blocked) throw new Error('not blocked: ' + JSON.stringify(r));
    const seen = log.slice(n); if (seen.some((x) => x.ran)) throw new Error('function code ran: ' + JSON.stringify(seen));
    if (!seen.length || seen[0].method !== 'OPTIONS' || seen[0].status !== 403) throw new Error('preflight: ' + JSON.stringify(seen));
    return 'preflight refused (403), no POST sent';
  });
}
await check('preflight from the allowed site: 204 with only POST/OPTIONS and the supabase-js headers, no wildcard', async () => {
  const res = await fetch(F + 'invite-user', { method: 'OPTIONS', headers: { Origin: A, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,apikey,content-type,x-client-info' } });
  const h = Object.fromEntries(res.headers);
  if (res.status !== 204 || h['access-control-allow-origin'] !== A || h['access-control-allow-methods'] !== 'POST, OPTIONS' || !/x-client-info/.test(h['access-control-allow-headers']) || h.vary !== 'Origin') throw new Error(JSON.stringify(h));
  return `allow-methods "${h['access-control-allow-methods']}"`;
});
await check('the preview address listed in ALLOWED_ORIGINS is accepted', async () => {
  const res = await fetch(F + 'send-emails', { method: 'OPTIONS', headers: { Origin: 'https://release-preview.dira-learn.pages.dev', 'Access-Control-Request-Method': 'POST' } });
  if (res.status !== 204) throw new Error(String(res.status)); return 'HTTP 204';
});
await check('the scheduler (no Origin header, x-cron-secret) still reaches send-emails', async () => {
  const res = await fetch(F + 'send-emails', { method: 'POST', headers: { 'x-cron-secret': ENV.CRON_SECRET, 'content-type': 'application/json' }, body: '{}' });
  if (res.status !== 503) throw new Error(String(res.status)); return 'HTTP 503 = ran, no email provider configured';
});
await check('a request without an Origin is still refused without a valid session (CORS is not the access control)', async () => {
  const res = await fetch(F + 'invite-user', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":"a@b.org","role":"trainer"}' });
  if (res.status !== 401) throw new Error(String(res.status)); return 'HTTP 401';
});

// Migration 35: the scheduled scanner also scans files of the other buckets, and records each result for the scanned version.
await check('scan-attachments: scans submissions/application files and records clean or infected per file version (fake ClamAV)', async () => {
  const scanner = http.createServer(async (q, r) => { const chunks = []; for await (const c of q) chunks.push(c); const body = Buffer.concat(chunks).toString();
    r.writeHead(body.includes('EICAR-TEST') ? 406 : 200); r.end(body.includes('EICAR-TEST') ? 'FOUND' : 'OK'); });
  const sp = await listen(scanner);
  Object.assign(ENV, { SCANNER_PROVIDER: 'clamav-rest', SCANNER_URL: `http://127.0.0.1:${sp}/scan` });
  globalThis.__fx.fileQueue = [{ bucket_id: 'submissions', object_name: 'u1/a.pdf', object_updated_at: '2026-11-20T10:00:00Z' },
                               { bucket_id: 'application-documents', object_name: 'u2/id.pdf', object_updated_at: '2026-11-20T10:05:00Z' }];
  globalThis.__fx.fileContent = { 'submissions/u1/a.pdf': '%PDF clean', 'application-documents/u2/id.pdf': 'X5O!P EICAR-TEST' };
  const n = globalThis.__calls.length;
  const res = await fetch(F + 'scan-attachments', { method: 'POST', headers: { 'x-cron-secret': ENV.CRON_SECRET } }); const out = await res.json();
  scanner.close();
  const rec2 = globalThis.__calls.slice(n).filter((x) => x.kind === 'rpc' && x.name === 'record_file_scan').map((x) => `${x.args.p_bucket}/${x.args.p_name}@${x.args.p_updated_at}=${x.args.p_result}`);
  const want = ['submissions/u1/a.pdf@2026-11-20T10:00:00Z=clean', 'application-documents/u2/id.pdf@2026-11-20T10:05:00Z=infected'];
  if (res.status !== 200 || JSON.stringify(rec2) !== JSON.stringify(want)) throw new Error(res.status + ' ' + JSON.stringify(out) + ' ' + JSON.stringify(rec2));
  return `${out.scanned} files: 1 clean, 1 infected`;
});
await check('scan-attachments: refused without the scheduler secret', async () => {
  const res = await fetch(F + 'scan-attachments', { method: 'POST' }); if (res.status !== 403) throw new Error(String(res.status)); return 'HTTP 403';
});

// ---------- bootstrap-first-admin (21 Nov 2026): signed-out operator, one-time SETUP_CODE, fixed FIRST_ADMIN_EMAIL ----------
const BOOT = 'bootstrap-first-admin'; const GOOD = 'correct-setup-code-123456'; const PW = 'Orange-Purple-2026-white';
const bootCalls = (n) => globalThis.__calls.slice(n);
const resetBoot = (users = []) => { globalThis.__fx.firstAdminNeeded = true; globalThis.__fx.authUsers = users; };
await check(`${BOOT}: the setup page can ask whether setup is open, signed out, and learns nothing else`, async () => {
  resetBoot(); const r = await invoke(pA, BOOT, null, { action: 'status' }); expectStatus(r, 200);
  if (JSON.stringify(r.body) !== '{"needed":true,"enabled":true}') throw new Error(JSON.stringify(r.body)); return JSON.stringify(r.body);
});
await check(`${BOOT}: a wrong setup code is refused after a delay and changes nothing`, async () => {
  resetBoot(); const n = globalThis.__calls.length; const t = Date.now(); const r = await invoke(pA, BOOT, null, { setupCode: 'wrong-code-wrong-code-wrong', password: PW });
  expectStatus(r, 403); if (Date.now() - t < 950) throw new Error('no delay');
  if (bootCalls(n).some((c) => ['createUser', 'updateUserById', 'listUsers'].includes(c.kind) || c.name === 'claim_first_admin')) throw new Error(JSON.stringify(bootCalls(n))); return 'HTTP 403 after >= 1 s, no account touched';
});
await check(`${BOOT}: a weak password is refused before any account is created`, async () => {
  resetBoot(); const n = globalThis.__calls.length; const r = await invoke(pA, BOOT, null, { setupCode: GOOD, password: 'short1' }); expectStatus(r, 400);
  if (bootCalls(n).some((c) => c.kind === 'createUser')) throw new Error('created'); return r.body.error;
});
await check(`${BOOT}: with the right code it creates FIRST_ADMIN_EMAIL (confirmed) through the Auth Admin API and makes it Super Administrator`, async () => {
  resetBoot(); const n = globalThis.__calls.length; const r = await invoke(pA, BOOT, null, { setupCode: GOOD, password: PW, email: 'attacker@example.org' }); expectStatus(r, 200);
  const c = bootCalls(n); const cu = c.filter((x) => x.kind === 'createUser'); const cl = c.filter((x) => x.name === 'claim_first_admin');
  if (cu.length !== 1 || cu[0].attrs.email !== 'marksmedia.studios@gmail.com' || cu[0].attrs.email_confirm !== true || cu[0].attrs.password !== PW) throw new Error(JSON.stringify(cu));
  if (cl.length !== 1 || cl[0].key !== 'service' || cl[0].args.p_user !== 'created-marksmedia.studios@gmail.com') throw new Error(JSON.stringify(cl));
  if (globalThis.__fx.profiles['created-marksmedia.studios@gmail.com'].role !== 'super_admin') throw new Error('role'); return 'created, email confirmed, claim as service role; the caller\'s "email" field was ignored';
});
await check(`${BOOT}: once a Super Administrator exists it refuses (409), even with the right code`, async () => {
  const n = globalThis.__calls.length; const r = await invoke(pA, BOOT, null, { setupCode: GOOD, password: PW }); expectStatus(r, 409);
  if (bootCalls(n).some((c) => ['createUser', 'updateUserById'].includes(c.kind))) throw new Error('changed'); return 'HTTP 409';
});
await check(`${BOOT}: if the account already signed up (applicant), it sets that account's password instead of creating a second one`, async () => {
  resetBoot([{ id: 'u-mark', email: 'MarksMedia.Studios@gmail.com' }]); globalThis.__fx.profiles['u-mark'] = { role: 'applicant', status: 'active' };
  const n = globalThis.__calls.length; const r = await invoke(pA, BOOT, null, { setupCode: GOOD, password: PW }); expectStatus(r, 200);
  const c = bootCalls(n); const up = c.filter((x) => x.kind === 'updateUserById');
  if (c.some((x) => x.kind === 'createUser') || up.length !== 1 || up[0].id !== 'u-mark' || up[0].attrs.password !== PW) throw new Error(JSON.stringify(c)); return 'updateUserById on the existing account';
});
await check(`${BOOT}: an existing account that already has another role is not touched`, async () => {
  resetBoot([{ id: 'u-mark2', email: 'marksmedia.studios@gmail.com' }]); globalThis.__fx.profiles['u-mark2'] = { role: 'participant', status: 'active' };
  const n = globalThis.__calls.length; const r = await invoke(pA, BOOT, null, { setupCode: GOOD, password: PW }); expectStatus(r, 409);
  if (bootCalls(n).some((x) => ['updateUserById', 'createUser'].includes(x.kind) || x.name === 'claim_first_admin')) throw new Error('changed'); return 'HTTP 409, nothing changed';
});
await check(`${BOOT}: switched off (503) when SETUP_CODE is removed`, async () => {
  resetBoot(); const keep = ENV.SETUP_CODE; delete ENV.SETUP_CODE; const r = await invoke(pA, BOOT, null, { setupCode: GOOD, password: PW }); ENV.SETUP_CODE = keep; expectStatus(r, 503); return 'HTTP 503';
});
await check(`${BOOT}: switched off (503) when SETUP_CODE is shorter than 20 characters`, async () => {
  resetBoot(); const keep = ENV.SETUP_CODE; ENV.SETUP_CODE = 'short-code'; const r = await invoke(pA, BOOT, null, { setupCode: 'short-code', password: PW }); ENV.SETUP_CODE = keep; expectStatus(r, 503); return 'HTTP 503';
});

// ---------- direct CSV enrolment (22 Nov 2026): import-learners + complete-enrolment ----------
const jwt = (claims) => 'h.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.sig';
const FX = globalThis.__fx; const callsFrom = (n) => globalThis.__calls.slice(n);
const MARY = 'invited-mary@example.com'; const maryParts = () => (FX.participants ?? []).filter((x) => x.profile_id === MARY);
await check('import-learners: valid rows are invited to /set-password; the track is saved server-side (app_metadata) and the names on the profile', async () => {
  const n = globalThis.__calls.length;
  const r = await invoke(pA, 'import-learners', 'tok-coord', { fileName: 'cohort.csv', rows: [
    { name: 'Mary Wanjiku', email: 'Mary@Example.com', programme_track: 'ai tools' }, { name: 'John Otieno', email: 'john@example.com', programme_track: 'Content Creation' }] });
  expectStatus(r, 200); if (r.body.invited !== 2 || r.body.failed !== 0) throw new Error(JSON.stringify(r.body));
  const c = callsFrom(n); const inv = c.filter((x) => x.kind === 'invite'); const meta = c.filter((x) => x.kind === 'updateUserById');
  if (inv.length !== 2 || inv[0].email !== 'mary@example.com' || inv[0].o.redirectTo !== A + '/set-password') throw new Error(JSON.stringify(inv));
  const m = meta[0]?.attrs.app_metadata?.dira_enrolment; if (!m || m.track_id !== 't-ai' || m.track_name !== 'AI Tools' || m.invited_by !== 'u-coord') throw new Error(JSON.stringify(meta));
  const prof = c.find((x) => x.kind === 'from' && x.table === 'profiles' && x.op === 'update' && x.filters.id === 'invited-mary@example.com');
  // 23 Nov 2026: the complete name is kept whole (never split into first and last name)
  if (!prof || prof.payload.first_name !== 'Mary Wanjiku' || prof.payload.last_name !== '' || 'role' in prof.payload) throw new Error(JSON.stringify(prof));
  const prof2 = c.find((x) => x.kind === 'from' && x.table === 'profiles' && x.op === 'update' && x.filters.id === 'invited-john@example.com');
  if (!prof2 || prof2.payload.first_name !== 'John Otieno' || prof2.payload.last_name !== '') throw new Error(JSON.stringify(prof2));
  return 'invited 2, name kept whole, track AI Tools recorded, role not touched';
});
await check('import-learners: invalid email, unknown track, missing name and duplicate email are refused per row and never invited', async () => {
  const n = globalThis.__calls.length;
  const r = await invoke(pA, 'import-learners', 'tok-coord', { rows: [
    { name: 'Brian Njima', email: 'brian@example.com', programme_track: 'Digital Skills' }, { name: 'Joy', email: 'not-an-email', programme_track: 'AI Tools' },
    { name: '', email: 'x@example.com', programme_track: 'AI Tools' }, { name: 'Ok One', email: 'ok@example.com', programme_track: 'Digital Marketing' },
    { name: 'Ok Again', email: 'OK@example.com', programme_track: 'Digital Marketing' }] });
  expectStatus(r, 200);
  const msg = r.body.rows.map((x) => `${x.rowNo}:${x.outcome}:${x.message ?? ''}`).join(' | ');
  if (msg !== '2:failed:Unknown programme track | 3:failed:Invalid email | 4:failed:Invalid name | 5:invited: | 6:failed:Duplicate email in file') throw new Error(msg);
  const inv = callsFrom(n).filter((x) => x.kind === 'invite').map((x) => x.email); if (JSON.stringify(inv) !== '["ok@example.com"]') throw new Error(JSON.stringify(inv));
  return msg;
});
await check('import-learners: an existing (confirmed) account is reported "already registered" and not changed; a sending failure is reported as failed, not as sent', async () => {
  FX.confirmedEmails = ['old@example.com']; FX.failEmails = ['limit@example.com']; const n = globalThis.__calls.length;
  const r = await invoke(pA, 'import-learners', 'tok-coord', { rows: [{ name: 'Old User', email: 'old@example.com', programme_track: 'AI Tools' }, { name: 'Lim It', email: 'limit@example.com', programme_track: 'AI Tools' }] });
  expectStatus(r, 200); const o = r.body.rows.map((x) => x.outcome + ':' + (x.message ?? '')).join(' | ');
  if (o !== 'already_registered: | failed:Email sending limit reached: try again later (set up Auth SMTP for larger imports)' || r.body.invited !== 0) throw new Error(o);
  if (callsFrom(n).some((x) => x.kind === 'updateUserById')) throw new Error('an account was changed'); return o;
});
await check('import-learners: a file with no rows, or an error, comes back as a JSON error with an HTTP status (never as success)', async () => {
  const r = await invoke(pA, 'import-learners', 'tok-coord', { rows: [] }); expectStatus(r, 400); if (r.body.error !== 'No learners supplied') throw new Error(JSON.stringify(r.body)); return 'HTTP 400 {"error":"No learners supplied"}';
});
await check('import-learners: one learner from the Add learner form uses the same checks and invitation; a learner invited earlier but not activated is reported as invited again', async () => {
  const n = globalThis.__calls.length;
  const r = await invoke(pA, 'import-learners', 'tok-coord', { fileName: 'Added on the dashboard', rows: [{ name: 'Mary Wanjiku', email: 'mary@example.com', programme_track: 'AI Tools' }] });
  expectStatus(r, 200); const row = r.body.rows[0];
  if (row.outcome !== 'invited' || row.message !== 'Already invited earlier, not yet activated') throw new Error(JSON.stringify(row));
  const batch = callsFrom(n).find((x) => x.table === 'import_batches' && x.op === 'insert'); if (batch?.payload.file_name !== 'Added on the dashboard') throw new Error(JSON.stringify(batch));
  const r2 = await invoke(pA, 'import-learners', 'tok-coord', { fileName: 'Added on the dashboard', rows: [{ name: 'Grace Akinyi', email: 'grace@example.com', programme_track: 'Entrepreneurship & Business' }] });
  expectStatus(r2, 200); if (r2.body.rows[0].message !== null || FX.appMeta['invited-grace@example.com'].dira_enrolment.track_id !== 't-eb') throw new Error(JSON.stringify(r2.body));
  return 'single row ok; re-invite reported';
});
await check('import-learners: the Add learner form cannot be used by a learner (403)', async () => {
  const r = await invoke(pA, 'import-learners', 'tok-learner', { fileName: 'Added on the dashboard', rows: [{ name: 'Me Myself', email: 'me@example.com', programme_track: 'AI Tools' }] }); expectStatus(r, 403); return 'HTTP 403';
});
// complete-enrolment
const PWTOK = jwt({ sub: 'invited-mary@example.com', amr: [{ method: 'password', timestamp: 1 }] }); const OTPTOK = jwt({ sub: 'invited-mary@example.com', amr: [{ method: 'otp', timestamp: 1 }] });
Object.assign(FX.tokens, { [PWTOK]: 'invited-mary@example.com', [OTPTOK]: 'invited-mary@example.com' }); FX.emails = { 'invited-mary@example.com': 'mary@example.com' };
await check('complete-enrolment: refused before the password is set (invitation-link session, no password sign-in); nothing changes', async () => {
  const n = globalThis.__calls.length; const r = await invoke(pA, 'complete-enrolment', OTPTOK, {}); expectStatus(r, 403);
  if (maryParts().length || FX.profiles[MARY].role !== 'applicant' || callsFrom(n).some((x) => x.op === 'insert')) throw new Error('changed'); return r.body.error;
});
await check('complete-enrolment: after the password sign-in the learner becomes an active participant with the imported track and no cohort', async () => {
  const n = globalThis.__calls.length; const r = await invoke(pA, 'complete-enrolment', PWTOK, {}); expectStatus(r, 200);
  const p = maryParts(); const c = callsFrom(n);
  if (p.length !== 1 || p[0].profile_id !== 'invited-mary@example.com' || p[0].programme_track_id !== 't-ai' || 'application_id' in p[0] || !/^DL-2026-/.test(p[0].participant_no)) throw new Error(JSON.stringify(p));
  if (FX.profiles['invited-mary@example.com'].role !== 'participant' || FX.profiles['invited-mary@example.com'].status !== 'active') throw new Error('role');
  if (c.some((x) => x.table === 'cohort_enrolments')) throw new Error('a cohort was assigned');
  if (!c.some((x) => x.table === 'portfolios' && x.op === 'insert')) throw new Error('no portfolio');
  if (!FX.appMeta['invited-mary@example.com'].dira_enrolment.completed_at) throw new Error('not marked complete');
  return `participant ${p[0].participant_no}, track t-ai, no cohort, role participant`;
});
await check('complete-enrolment: running it again creates no second participant or portfolio', async () => {
  const r = await invoke(pA, 'complete-enrolment', PWTOK, {}); expectStatus(r, 200);
  const pid = maryParts()[0]?.id; if (r.body.already !== true || maryParts().length !== 1 || FX.portfolios.filter((x) => x.participant_id === pid).length !== 1) throw new Error(JSON.stringify(r.body)); return 'already: true';
});
await check('complete-enrolment: an account that was not imported (public applicant) cannot use it, even with a password sign-in', async () => {
  const T = jwt({ sub: 'u-pub', amr: [{ method: 'password' }] }); FX.tokens[T] = 'u-pub'; FX.profiles['u-pub'] = { role: 'applicant', status: 'active' };
  const before = (FX.participants ?? []).length; const r = await invoke(pA, 'complete-enrolment', T, {}); expectStatus(r, 403);
  if (FX.profiles['u-pub'].role !== 'applicant' || (FX.participants ?? []).length !== before) throw new Error('changed'); return r.body.error;
});
await check('complete-enrolment: a deactivated imported account, or one with another role, is not changed', async () => {
  const T1 = jwt({ amr: [{ method: 'password' }], n: 1 }); const T2 = jwt({ amr: [{ method: 'password' }], n: 2 });
  Object.assign(FX.tokens, { [T1]: 'imp-deact', [T2]: 'imp-trainer' }); Object.assign(FX.profiles, { 'imp-deact': { role: 'applicant', status: 'deactivated' }, 'imp-trainer': { role: 'trainer', status: 'active' } });
  Object.assign(FX.appMeta, { 'imp-deact': { dira_enrolment: { track_id: 't-ai' } }, 'imp-trainer': { dira_enrolment: { track_id: 't-ai' } } });
  const before = FX.participants.length; const a = await invoke(pA, 'complete-enrolment', T1, {}); const b = await invoke(pA, 'complete-enrolment', T2, {}); expectStatus(a, 409); expectStatus(b, 409);
  if (FX.participants.length !== before || FX.profiles['imp-trainer'].role !== 'trainer' || FX.profiles['imp-deact'].role !== 'applicant') throw new Error('changed'); return 'HTTP 409 twice, nothing created';
});
await check('complete-enrolment: refused without a sign-in', async () => { const r = await invoke(pA, 'complete-enrolment', null, {}); expectStatus(r, 401); return 'HTTP 401'; });

// ---------- Google Calendar one-way sync (22 Nov 2026): the real function, Google's token and Calendar endpoints simulated ----------
{
  const { generateKeyPairSync, createVerify } = await import('node:crypto');
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString().replace(/\n/g, '\\n');   // as pasted into a secret: \n as text
  const G = { mode: 'ok', calls: [], events: new Map(), tokenMode: 'ok', assertions: [] };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith('https://oauth2.googleapis.com/') && !url.startsWith('https://www.googleapis.com/')) return realFetch(input, init);
    const method = (init.method ?? 'GET').toUpperCase(); G.calls.push({ method, url, body: init.body ? String(init.body) : null, auth: init.headers?.Authorization });
    const J = (b, s) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });
    if (url === 'https://oauth2.googleapis.com/token') {
      const assertion = new URLSearchParams(String(init.body)).get('assertion'); G.assertions.push(assertion);
      const [h, c, sig] = assertion.split('.'); const v = createVerify('RSA-SHA256'); v.update(`${h}.${c}`);
      if (G.tokenMode !== 'ok' || !v.verify(publicKey, Buffer.from(sig, 'base64url'))) return J({ error: 'invalid_grant' }, 400);
      return J({ access_token: 'ya29.test-token', expires_in: 3600 }, 200);
    }
    const m = url.match(/calendars\/([^/]+)\/events(?:\/([a-v0-9]+))?/);
    if (decodeURIComponent(m[1]) !== 'dira-calendar@group.calendar.google.com') return J({ error: { message: 'Not Found' } }, 404);
    if (G.mode === 'down') return J({ error: { message: 'Backend Error' } }, 503);
    const id = m[2];
    if (method === 'POST') { const ev = JSON.parse(init.body); if (G.events.has(ev.id)) return J({ error: { message: 'The requested identifier already exists.' } }, 409); G.events.set(ev.id, ev); return J(ev, 200); }
    if (method === 'PATCH') { if (!G.events.has(id)) return J({ error: { message: 'Not Found' } }, 404); G.events.set(id, { ...G.events.get(id), ...JSON.parse(init.body) }); return J(G.events.get(id), 200); }
    if (method === 'DELETE') { if (!G.events.has(id)) return J({ error: { message: 'Resource has been deleted' } }, 410); G.events.delete(id); return new Response(null, { status: 204 }); }
    return J({}, 400);
  };
  const FX = globalThis.__fx;
  const item = (op, extra = {}) => ({ schedule_id: '5555-sched-1', google_event_id: 'dira55556666000000000000000000000001', operation: op, title: 'DIRA LEARN: Prompting basics (Cohort A)',
    description: 'Cohort: Cohort A', location: 'Nairobi hub', starts_at: '2026-12-01T07:00:00+00:00', ends_at: '2026-12-01T09:00:00+00:00', ...extra });
  const records = (n) => globalThis.__calls.slice(n).filter((c) => c.kind === 'rpc' && c.name === 'gcal_record').map((c) => c.args);
  const setGoogle = (on) => { for (const [k, v] of Object.entries({ GOOGLE_SERVICE_ACCOUNT_EMAIL: 'dira-sync@dira-learn.iam.gserviceaccount.com', GOOGLE_SERVICE_ACCOUNT_KEY: PEM, GOOGLE_CALENDAR_ID: 'dira-calendar@group.calendar.google.com' })) { if (on) ENV[k] = v; else delete ENV[k]; } };
  await check('google-calendar-sync: refused for a learner (403)', async () => { const r = await invoke(pA, 'google-calendar-sync', 'tok-learner', {}); expectStatus(r, 403); return 'HTTP 403'; });
  await check('google-calendar-sync: without the Google secrets it does nothing and says so (503); the queue waits', async () => {
    setGoogle(false); FX.gcalQueue = [item('upsert')]; const r = await invoke(pA, 'google-calendar-sync', 'tok-coord', {}); expectStatus(r, 503);
    if (FX.gcalQueue.length !== 1 || G.calls.length) throw new Error('queue touched or Google called'); FX.gcalQueue = []; return r.body.error.slice(0, 60);
  });
  setGoogle(true);
  await check('google-calendar-sync: a new session creates ONE Google event with the fixed id, title, place and time zone; signed in as the service account (RS256, calendar.events scope)', async () => {
    const n = globalThis.__calls.length; FX.gcalQueue = [item('upsert')]; const r = await invoke(pA, 'google-calendar-sync', 'tok-coord', {}); expectStatus(r, 200);
    const ev = G.events.get('dira55556666000000000000000000000001');
    if (!ev || ev.summary !== 'DIRA LEARN: Prompting basics (Cohort A)' || ev.location !== 'Nairobi hub' || ev.start.timeZone !== 'Africa/Nairobi' || ev.extendedProperties.private.dira_schedule_id !== '5555-sched-1') throw new Error(JSON.stringify(ev));
    const claims = JSON.parse(Buffer.from(G.assertions.at(-1).split('.')[1], 'base64url').toString());
    if (claims.iss !== 'dira-sync@dira-learn.iam.gserviceaccount.com' || claims.scope !== 'https://www.googleapis.com/auth/calendar.events' || claims.aud !== 'https://oauth2.googleapis.com/token') throw new Error(JSON.stringify(claims));
    if (!G.calls.filter((c) => c.method === 'POST' && c.url.includes('/events')).every((c) => c.auth === 'Bearer ya29.test-token')) throw new Error('token not used');
    const rec = records(n); if (rec.length !== 1 || rec[0].p_ok !== true) throw new Error(JSON.stringify(rec));
    return `synced: ${JSON.stringify(r.body)}`;
  });
  await check('google-calendar-sync: an edited session updates the same event (create answers 409, then PATCH) - still one event', async () => {
    const before = G.calls.length; FX.gcalQueue = [item('upsert', { location: 'Room 2' })]; const r = await invoke(pA, 'google-calendar-sync', 'tok-coord', {}); expectStatus(r, 200);
    const methods = G.calls.slice(before).filter((c) => c.url.includes('/events')).map((c) => c.method).join(',');
    if (methods !== 'POST,PATCH' || G.events.size !== 1 || G.events.get('dira55556666000000000000000000000001').location !== 'Room 2') throw new Error(methods + ' ' + G.events.size); return methods;
  });
  await check('google-calendar-sync: a cancelled or deleted session deletes the event; deleting again counts as done (410)', async () => {
    const n = globalThis.__calls.length; FX.gcalQueue = [item('delete')]; await invoke(pA, 'google-calendar-sync', 'tok-coord', {});
    FX.gcalQueue = [item('delete')]; await invoke(pA, 'google-calendar-sync', 'tok-coord', {});
    const rec = records(n); if (G.events.size !== 0 || rec.length !== 2 || !rec.every((x) => x.p_ok === true)) throw new Error(JSON.stringify(rec)); return 'deleted; repeat = ok';
  });
  await check('google-calendar-sync: when Google is unavailable the failure is recorded with the reason (for retry), nothing else breaks', async () => {
    G.mode = 'down'; const n = globalThis.__calls.length; FX.gcalQueue = [item('upsert')]; const r = await invoke(pA, 'google-calendar-sync', 'tok-coord', {}); G.mode = 'ok';
    expectStatus(r, 200); const rec = records(n);
    if (r.body.failed !== 1 || rec[0].p_ok !== false || rec[0].p_error !== 'Google Calendar answered HTTP 503: Backend Error') throw new Error(JSON.stringify(rec)); return rec[0].p_error;
  });
  await check('google-calendar-sync: a rejected Google sign-in records every claimed item as failed (502), no event is touched', async () => {
    G.tokenMode = 'bad'; const before = G.calls.length; const n = globalThis.__calls.length; FX.gcalQueue = [item('upsert'), item('delete', { schedule_id: 'x2' })];
    const r = await invoke(pA, 'google-calendar-sync', 'tok-coord', {}); G.tokenMode = 'ok'; expectStatus(r, 502);
    if (records(n).length !== 2 || records(n).some((x) => x.p_ok) || G.calls.slice(before).some((c) => c.url.includes('/events'))) throw new Error('wrong'); return r.body.error;
  });
  await check('google-calendar-sync: the scheduler can run it with the x-cron-secret header; a wrong secret is refused', async () => {
    current = 'google-calendar-sync';
    const call = (secret) => handlers['google-calendar-sync'](new Request('http://fn/google-calendar-sync', { method: 'POST', headers: { 'x-cron-secret': secret, 'Content-Type': 'application/json' }, body: '{}' }));
    FX.gcalQueue = []; const ok1 = await call('cron-secret-0123456789'); const bad = await call('cron-secret-wrong-wrong');
    if (ok1.status !== 200 || bad.status !== 403) throw new Error(ok1.status + '/' + bad.status); return '200 / 403';
  });
  await check('google-calendar-sync: no Google secret or token ever appears in a response', async () => {
    FX.gcalQueue = [item('upsert')]; G.mode = 'down'; const r = await invoke(pA, 'google-calendar-sync', 'tok-coord', {}); G.mode = 'ok';
    const t = JSON.stringify(r.body); if (t.includes('ya29') || t.includes('PRIVATE KEY') || t.includes('BEGIN')) throw new Error(t); return 'clean';
  });
  globalThis.fetch = realFetch; setGoogle(false);
}

await browser.close(); fnServer.close(); process.exitCode = results.every((r) => r[1]) ? 0 : 1;
for (const [l, ok, why] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${l}${why ? '  (' + why + ')' : ''}`);
console.log(`Edge Functions in Chrome (real function code, simulated Supabase): ${results.filter((r) => r[1]).length}/${results.length} checks passed`);
process.exit(process.exitCode);
