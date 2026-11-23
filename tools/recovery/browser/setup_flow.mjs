// First Super Administrator setup (/setup) and Change password (/account/password) in Chrome (21 Nov 2026), with the REAL
// SetupPage, ChangePasswordPage, LoginPage, AuthProvider and ProtectedRoute and the SIMULATED Supabase in fake-supabase.ts
// (the Edge Function bootstrap-first-admin is simulated with the answers of the real one, which tools/edge-browser tests).
// Usage: node setup_flow.mjs <project>   (RECOVERY_CSP=1: served with the production Content-Security-Policy)
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { execFileSync } from 'node:child_process';
const proj = process.argv[2]; const here = path.dirname(new URL(import.meta.url).pathname);
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-flow-'));
execFileSync('node', [path.join(here, 'build.mjs'), proj, out], { stdio: 'inherit' });
fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
const csp = process.env.RECOVERY_CSP ? (await import(path.join(path.resolve(proj), 'scripts', 'write-headers.mjs'))).buildCsp({ supabaseUrl: 'https://abcd.supabase.co', photoOrigin: 'https://dirafoundationken.netlify.app' }) : null;
const server = http.createServer((q, r) => { const f = q.url.startsWith('/app.js') ? 'app.js' : 'index.html'; r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html', ...(csp ? { 'content-security-policy': csp } : {}) }); r.end(fs.readFileSync(path.join(out, f))); });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const results = []; const logs = [];
const CODE = 'correct-setup-code-123456', ADMIN = 'marksmedia.studios@gmail.com', PW = 'Orange-Purple-2026-white', PW2 = 'Purple-Orange-2027-new';
const FOUNDER = { id: 'u-founder', email: 'founder@dira-test.local', password: 'DiraTest2026', role: 'founder' };

async function fresh(start, setup = {}, users = []) {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  page.on('console', (m) => logs.push(m.text()));
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => { (window.__csp ??= []).push(e.violatedDirective + ' ' + e.blockedURI); }));
  // the simulated server state must exist before the page's first request, so it is set up before the app script runs
  await page.addInitScript(([s, u]) => { window.__preset = { s, u }; }, [setup, users]);
  await page.goto(base + '/login');
  await page.evaluate(({ s, u }) => { Object.assign(window.__auth.setup, s); window.__auth.users.push(...u); }, { s: setup, u: users });
  await page.evaluate((to) => { history.pushState({ usr: null }, '', to); dispatchEvent(new PopStateEvent('popstate')); }, start);
  return { ctx, page };
}
const text = (page) => page.locator('body').innerText();
const expect = (c, m) => { if (!c) throw new Error(m); };
async function check(name, start, setup, users, fn) {
  const { ctx, page } = await fresh(start, setup, users);
  try { await fn(page); const v = await page.evaluate(() => window.__csp ?? []); if (v.length) throw new Error('CSP violations: ' + v.join('; ')); results.push([name, true]); }
  catch (e) { results.push([name, false, String(e.message ?? e).split('\n')[0] + ' | page: ' + (await text(page).catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)]); }
  await ctx.close();
}
async function fillSetup(p, code, pw, confirm = pw) {
  await p.getByLabel(/^Setup code/).fill(code); await p.getByLabel(/^Administrator password/).fill(pw); await p.getByLabel('Confirm password').fill(confirm);
  await p.getByRole('button', { name: 'Create the Super Administrator' }).click();
}
const claims = (p) => p.evaluate(() => window.__auth.invokes.filter((x) => x.endsWith(':claim')).length);

await check('setup page: signed out, setup open -> form with setup code and password (no sign-up needed first)', '/setup', {}, [], async (p) => {
  await p.getByRole('heading', { name: 'First-time setup' }).waitFor();
  expect((await text(p)).includes('FIRST_ADMIN_EMAIL'), 'does not explain which address is used');
  expect(await p.getByLabel(/^Setup code/).getAttribute('type') === 'password', 'setup code is shown in clear by default');
});
await check('setup page: a weak password and a mismatch are refused in the page, before the function is called', '/setup', {}, [], async (p) => {
  await fillSetup(p, CODE, 'short12'); expect((await p.getByRole('alert').textContent()).includes('at least 12'), 'weak not refused');
  await fillSetup(p, CODE, PW, PW + 'x'); expect((await p.getByRole('alert').textContent()).includes('do not match'), 'mismatch not refused');
  await fillSetup(p, CODE, 'abcdefghijklmn'); expect((await p.getByRole('alert').textContent()).includes('letters and numbers'), 'no-digit not refused');
  expect(await claims(p) === 0, 'function was called');
});
await check('setup page: a wrong setup code shows the server message and creates nothing', '/setup', {}, [], async (p) => {
  await fillSetup(p, 'wrong-code-wrong-code-xx', PW);
  await p.getByText('That setup code is not right.').waitFor();
  expect(await p.evaluate(() => window.__auth.users.length) === 0, 'an account was created');
});
await check('setup page: the right code creates the Super Administrator for FIRST_ADMIN_EMAIL, signs in, clears the fields and says to remove SETUP_CODE', '/setup', {}, [], async (p) => {
  await fillSetup(p, CODE, PW);
  await p.getByRole('heading', { name: 'Setup is complete' }).waitFor();
  const t = await text(p); expect(t.includes(ADMIN) && t.includes('You are signed in') && t.includes('SETUP_CODE'), 'completion text: ' + t.slice(0, 200));
  const st = await p.evaluate(() => ({ s: JSON.parse(localStorage.getItem('fake-session') ?? 'null'), u: window.__auth.users }));
  expect(st.s?.user.email === ADMIN, 'not signed in as the administrator');
  expect(st.u.length === 1 && st.u[0].role === 'super_admin' && st.u[0].email === ADMIN, JSON.stringify(st.u));
  expect(!(await p.content()).includes(PW), 'the password is still in the page');
});
await check('setup page: once an administrator exists it says setup is complete and offers sign in / forgot password, no form', '/setup', {}, [{ id: 'u-a', email: ADMIN, password: PW, role: 'super_admin' }], async (p) => {
  await p.getByRole('heading', { name: 'Setup is already complete' }).waitFor();
  expect(await p.getByLabel(/^Setup code/).count() === 0, 'form shown');
  expect(await p.getByRole('link', { name: 'Forgot password' }).count() === 1, 'no forgot-password link');
});
await check('setup page: SETUP_CODE removed -> "Setup is switched off"', '/setup', { enabled: false }, [], async (p) => {
  await p.getByRole('heading', { name: 'Setup is switched off' }).waitFor();
});
async function signInFounder(p, pw = FOUNDER.password) {
  await p.evaluate(() => { history.pushState({ usr: null }, '', '/login'); dispatchEvent(new PopStateEvent('popstate')); });
  await p.getByLabel('Email address').fill(FOUNDER.email); await p.locator('#login-password').fill(pw);
  await p.getByRole('button', { name: 'Sign in' }).click(); await p.getByRole('heading', { name: 'Dashboard (signed in)' }).waitFor();
  await p.evaluate(() => { history.pushState({ usr: null }, '', '/account/password'); dispatchEvent(new PopStateEvent('popstate')); });
  await p.getByRole('heading', { name: 'Change password' }).waitFor();
}
async function change(p, cur, pw, confirm = pw) {
  await p.getByLabel('Current password').fill(cur); await p.locator('#cp-new').fill(pw); await p.getByLabel('Confirm new password').fill(confirm);
  await p.getByRole('button', { name: 'Change password' }).click();
}
await check('change password: signed out, the page is not shown (sign-in required)', '/account/password', {}, [FOUNDER], async (p) => {
  await p.waitForTimeout(500); expect(await p.getByRole('heading', { name: 'Change password' }).count() === 0, 'page shown signed out');
});
await check('change password: a wrong current password is refused and nothing changes', '/login', {}, [FOUNDER], async (p) => {
  await signInFounder(p); await change(p, 'NotMyPassword1', PW2);
  await p.getByText('Your current password is not right.').waitFor();
  expect(await p.evaluate(() => window.__auth.users[0].password) === FOUNDER.password, 'password changed');
});
await check('change password: mismatch and same-as-current are refused in the page', '/login', {}, [FOUNDER], async (p) => {
  await signInFounder(p); await change(p, FOUNDER.password, PW2, PW2 + 'x'); expect((await p.getByRole('alert').textContent()).includes('do not match'), 'mismatch');
  await change(p, FOUNDER.password, FOUNDER.password); expect((await p.getByRole('alert').textContent()).includes('different'), 'same');
  expect(await p.evaluate(() => window.__auth.updates.length) === 0, 'updateUser called');
});
await check('change password: the right current password saves the new one; signing in again works only with the new one', '/login', {}, [FOUNDER], async (p) => {
  await signInFounder(p); await change(p, FOUNDER.password, PW2);
  await p.getByText('Your password has been changed.').waitFor();
  expect(await p.getByLabel('Current password').inputValue() === '', 'fields not cleared');
  await p.evaluate(() => window.__signOut());
  await p.evaluate(() => { history.pushState({ usr: null }, '', '/login'); dispatchEvent(new PopStateEvent('popstate')); });
  await p.getByLabel('Email address').fill(FOUNDER.email); await p.locator('#login-password').fill(FOUNDER.password);
  await p.getByRole('button', { name: 'Sign in' }).click(); await p.getByRole('alert').waitFor();
  await p.locator('#login-password').fill(PW2); await p.getByRole('button', { name: 'Sign in' }).click();
  await p.getByRole('heading', { name: 'Dashboard (signed in)' }).waitFor();
});
results.push(['nothing written to the browser console contains a setup code or a password', ![CODE, PW, PW2, FOUNDER.password].some((s) => logs.join('\n').includes(s))]);

await browser.close(); server.close();
const failed = results.filter((r) => !r[1]);
console.log(`first-administrator setup and change password in Chrome (simulated Supabase${csp ? ', production Content-Security-Policy' : ''}): ${results.length - failed.length}/${results.length} checks passed`);
for (const f of failed) console.log('  FAILED ' + f[0] + (f[2] ? ' - ' + f[2] : ''));
process.exit(failed.length ? 1 : 0);
