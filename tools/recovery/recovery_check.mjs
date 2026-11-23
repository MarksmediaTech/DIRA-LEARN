#!/usr/bin/env node
// Password recovery against the REAL local Supabase Auth and its test inbox (Mailpit), on your own computer only.
// Run by TEST-PASSWORD-RECOVERY.bat, which supplies LOCAL_API_URL, LOCAL_ANON_KEY, LOCAL_MAIL_URL and DB_CONTAINER.
// It temporarily changes the passwords of local TEST accounts (@dira-test.local) and puts them back to DiraTest!2026 at the end.
// It never prints a code, a password or a token. It refuses any address that is not on this computer. Needs Node 18+.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const API = (process.env.LOCAL_API_URL ?? '').replace(/\/$/, '');
const KEY = process.env.LOCAL_ANON_KEY ?? '';
const MAIL = (process.env.LOCAL_MAIL_URL || 'http://127.0.0.1:54324').replace(/\/$/, '');
const DB = process.env.DB_CONTAINER ?? '';
const TEST_PASSWORD = 'DiraTest!2026';
// Seconds to wait for Supabase's once-a-minute limit. Only the dry run (tools/recovery/dryrun) shortens it, together with its mock server.
const COOLDOWN_MS = 1000 * Number(process.env.RECOVERY_COOLDOWN_SECONDS ?? 61);
const local = (u) => /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(u);
if (!local(API) || !local(MAIL) || !KEY) { console.log('STOPPED: this check only runs against the local Supabase on this computer.'); process.exit(2); }
if (!/^supabase_db_dira-learn/.test(DB)) { console.log('STOPPED: the local DIRA LEARN database container was not found.'); process.exit(2); }

const results = []; const changed = new Map();   // email -> temporary password (kept in memory only, to restore)
const check = (name, ok, note = '') => { results.push([name, !!ok, note]); console.log(`${ok ? '  ok  ' : '  FAIL'} ${name}${note ? ' (' + note + ')' : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tempPassword = () => 'Rec' + randomBytes(9).toString('base64url').replace(/[^A-Za-z0-9]/g, 'x') + '7';
async function auth(path, body, { method = 'POST', token } = {}) {
  const r = await fetch(API + '/auth/v1' + path, { method, headers: { apikey: KEY, 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = {}; try { json = await r.json(); } catch { /* empty body */ }
  return { status: r.status, json, code: json.error_code ?? json.code ?? '' };
}
const recover = (email) => auth('/recover', { email });
const verify = (email, token) => auth('/verify', { type: 'recovery', email, token });
const login = (email, password) => auth('/token?grant_type=password', { email, password });
const setPassword = (token, password) => auth('/user', { password }, { method: 'PUT', token });
const sql = (q) => execFileSync('docker', ['exec', DB, 'psql', '-U', 'postgres', '-d', 'postgres', '-tAX', '-c', q], { encoding: 'utf8' }).trim();

// ---- local test inbox: Mailpit (Supabase CLI 2.x and 3.x); Inbucket API as a fallback for older CLIs ----
async function mailsFor(email, since) {
  try {
    const r = await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent('to:' + email)}&limit=20`);
    if (r.ok) {
      const j = await r.json();
      const out = [];
      for (const m of j.messages ?? []) {
        if (new Date(m.Created).getTime() < since) continue;
        const full = await (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json();
        out.push({ subject: m.Subject ?? '', text: (full.Text ?? '') + ' ' + (full.HTML ?? ''), at: new Date(m.Created).getTime() });
      }
      return out.sort((a, b) => b.at - a.at);
    }
  } catch { /* not Mailpit */ }
  const box = email.split('@')[0];
  const r = await fetch(`${MAIL}/api/v1/mailbox/${box}`); if (!r.ok) return [];
  const out = [];
  for (const m of await r.json()) {
    const at = new Date(m.date).getTime(); if (at < since) continue;
    const full = await (await fetch(`${MAIL}/api/v1/mailbox/${box}/${m.id}`)).json();
    out.push({ subject: m.subject ?? '', text: (full.body?.text ?? '') + ' ' + (full.body?.html ?? ''), at });
  }
  return out.sort((a, b) => b.at - a.at);
}
async function waitForCode(email, since, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const m = (await mailsFor(email, since))[0];
    if (m) { const c = m.text.match(/\b(\d{6,10})\b/); return { mail: m, code: c ? c[1] : null }; }
    await sleep(700);
  }
  return { mail: null, code: null };
}
const profiles = () => sql("select coalesce(json_agg(json_build_object('e', u.email, 'role', p.role, 'status', p.status, 'f', p.first_name, 'l', p.last_name, 'org', p.organization_id) order by u.email), '[]') from auth.users u join profiles p on p.id = u.id where u.email like '%@dira-test.local'");

async function fullReset(email, newPassword, label) {
  const t0 = Date.now() - 2000;
  const r = await recover(email);
  const { code } = await waitForCode(email, t0);
  if (r.status !== 200 || !code) return { ok: false, why: `request ${r.status}, code ${code ? 'received' : 'missing'}` };
  const v = await verify(email, code);
  if (v.status !== 200 || !v.json.access_token) return { ok: false, why: 'verify ' + v.status };
  const u = await setPassword(v.json.access_token, newPassword);
  await auth('/logout?scope=global', null, { token: v.json.access_token });
  return { ok: u.status === 200, why: label + ' update ' + u.status };
}

async function main() {
  console.log(`Password recovery check against the LOCAL Supabase (${API}) and test inbox (${MAIL})`);
  const pre = await login('learner1@dira-test.local', TEST_PASSWORD);
  if (pre.status !== 200) { console.log('STOPPED: the local test accounts are missing or their password is not DiraTest!2026. Run CREATE-DIRA-TEST-ACCOUNTS.bat first.'); process.exit(2); }
  const before = profiles();

  // 1. request: unknown and registered addresses look the same
  const t0 = Date.now() - 2000;
  const unknown = await recover('nobody-' + randomBytes(4).toString('hex') + '@dira-test.local');
  const known = await recover('learner1@dira-test.local');
  check('requesting a code for a registered address is accepted', known.status === 200);
  check('an unknown address gets the same response (no account disclosure)', unknown.status === known.status && JSON.stringify(unknown.json) === JSON.stringify(known.json));
  const { mail, code } = await waitForCode('learner1@dira-test.local', t0);
  check('the recovery email arrives in the local test inbox with a code', !!mail && !!code);
  check('the email identifies DIRA LEARN and explains the code', !!mail && /DIRA LEARN/.test(mail.subject + mail.text) && /15 minutes/.test(mail.text) && /only once/i.test(mail.text));
  check('the email contains no password and no reset link', !!mail && !mail.text.includes(TEST_PASSWORD) && !/[?&]token=|verify\?token|type=recovery/i.test(mail.text));
  check('the code has the configured length (6 digits)', !!code && code.length === 6);

  // 2. resend cooldown (the screens show the same message either way; the server simply refuses a second email for 60 s)
  const again = await recover('learner1@dira-test.local');
  check('asking again within 60 seconds is refused by Supabase (resend cooldown)', again.status === 429, `status ${again.status}`);

  // 3. without verification, nothing can be changed
  const noTok = await setPassword('', 'NoVerify2026x');
  check('changing a password without recovery verification is refused', noTok.status === 401 || noTok.status === 403, `status ${noTok.status}`);
  const wrong = await verify('learner1@dira-test.local', code === '000000' ? '111111' : '000000');
  check('an incorrect code is refused', wrong.status >= 400 && !wrong.json.access_token, `status ${wrong.status} ${wrong.code}`);
  const otherUser = await verify('learner2@dira-test.local', code);
  check('one person\'s code does not work for another account', otherUser.status >= 400 && !otherUser.json.access_token);

  // 4. correct code, single use, password rules, new password works
  const ok = await verify('learner1@dira-test.local', code);
  check('the correct code is accepted with type "recovery"', ok.status === 200 && !!ok.json.access_token);
  const reuse = await verify('learner1@dira-test.local', code);
  check('the same code cannot be used twice', reuse.status >= 400 && !reuse.json.access_token, `status ${reuse.status}`);
  const weak = await setPassword(ok.json.access_token, 'short1');
  check('a password that breaks the DIRA LEARN rules is refused by Supabase too', weak.status === 422 || weak.status === 400, `status ${weak.status} ${weak.code}`);
  const lettersOnly = await setPassword(ok.json.access_token, 'onlyletterspassword');
  check('a long letters-only password is refused (letters and digits required)', lettersOnly.status === 422 || lettersOnly.status === 400, `status ${lettersOnly.status}`);
  const newPw = tempPassword(); changed.set('learner1@dira-test.local', newPw);
  const upd = await setPassword(ok.json.access_token, newPw);
  check('a valid new password is saved', upd.status === 200, `status ${upd.status}`);
  await auth('/logout?scope=global', null, { token: ok.json.access_token });
  check('signing in with the old password no longer works', (await login('learner1@dira-test.local', TEST_PASSWORD)).status === 400);
  check('signing in with the new password works', (await login('learner1@dira-test.local', newPw)).status === 200);

  // 5. staff use the same process; expiry; a newer code replaces the older one
  const staffPw = tempPassword(); changed.set('director@dira-test.local', staffPw);
  const staff = await fullReset('director@dira-test.local', staffPw, 'Programme Director');
  check('a staff account (Programme Director) recovers through exactly the same steps', staff.ok, staff.why);
  check('the Programme Director can sign in with the new password', (await login('director@dira-test.local', staffPw)).status === 200);

  const t1 = Date.now() - 2000;
  await recover('founder@dira-test.local');
  const f1 = await waitForCode('founder@dira-test.local', t1);
  sql("update auth.users set recovery_sent_at = now() - interval '16 minutes' where email = 'founder@dira-test.local'");
  if (sql("select to_regclass('auth.one_time_tokens') is not null") === 't')
    sql("update auth.one_time_tokens set created_at = now() - interval '16 minutes' where user_id = (select id from auth.users where email = 'founder@dira-test.local') and token_type::text = 'recovery_token'");
  const expired = await verify('founder@dira-test.local', f1.code ?? '');
  check('an expired code (older than 15 minutes) is refused', !!f1.code && expired.status >= 400 && !expired.json.access_token, `status ${expired.status}`);

  console.log(`  ...waiting ${COOLDOWN_MS / 1000} seconds for the resend cooldown`);
  await sleep(COOLDOWN_MS);
  const t2 = Date.now() - 2000;
  const resend = await recover('founder@dira-test.local');
  const f2 = await waitForCode('founder@dira-test.local', t2);
  check('after the cooldown a new code can be requested', resend.status === 200 && !!f2.code);
  const t3 = Date.now() - 2000;
  await sleep(COOLDOWN_MS);
  await recover('founder@dira-test.local');
  const f3 = await waitForCode('founder@dira-test.local', t3 + 2000);
  const oldOne = await verify('founder@dira-test.local', f2.code ?? '');
  check('a newer code replaces the older one', !!f3.code && f3.code !== f2.code && oldOne.status >= 400);
  const fOk = await verify('founder@dira-test.local', f3.code ?? '');
  check('the Founder\'s newest code is accepted', fOk.status === 200);
  if (fOk.json.access_token) await auth('/logout?scope=global', null, { token: fOk.json.access_token });

  // 6. roles, status and profiles unchanged
  check('no role, status, name or organisation changed for any test account', profiles() === before);
}

async function restore() {
  if (!changed.size) return;
  console.log('  ...putting the test passwords back to DiraTest!2026 (waits for the 60-second cooldown)');
  await sleep(COOLDOWN_MS);
  for (const [email] of changed) {
    const r = await fullReset(email, TEST_PASSWORD, 'restore');
    check(`test password restored for ${email}`, r.ok && (await login(email, TEST_PASSWORD)).status === 200, r.ok ? '' : r.why);
  }
}

async function rateLimit() {
  // Last on purpose: after this, Supabase refuses code checks from this computer for about 5 minutes.
  let limited = false;
  for (let i = 0; i < 40 && !limited; i++) { const r = await verify('mentor@dira-test.local', String(100000 + i)); limited = r.status === 429; }
  check('repeated code guessing is stopped by Supabase\'s rate limit (30 checks per 5 minutes)', limited);
}

try { await main(); } catch (e) { check('the check ran to the end', false, String(e.message ?? e).split('\n')[0]); }
try { await restore(); } catch (e) { check('test passwords restored', false, 'restore stopped: use Forgot password with the local inbox (http://localhost:54324)'); }
try { await rateLimit(); } catch (e) { check('rate limit check', false, String(e.message ?? e).split('\n')[0]); }
const failed = results.filter((r) => !r[1]);
console.log(`\npassword recovery (real local Supabase): ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
