// Registration -> email verification link -> back on DIRA LEARN -> profile, in Chrome, with the REAL SignUpPage, LoginPage,
// AuthProvider and ProtectedRoute and the SIMULATED Supabase in fake-supabase.ts (sign-up email, verification link with the
// session in the URL, database trigger that creates the profile, and the failures production could meet).
// Usage: node auth_flow.mjs <project>   (RECOVERY_CSP=1: served with the production Content-Security-Policy)
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { execFileSync } from 'node:child_process';
const proj = process.argv[2]; const here = path.dirname(new URL(import.meta.url).pathname);
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-flow-'));
execFileSync('node', [path.join(here, 'build.mjs'), proj, out], { stdio: 'inherit' });
fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
const csp = process.env.RECOVERY_CSP ? (await import(path.join(path.resolve(proj), 'scripts', 'write-headers.mjs'))).buildCsp({ supabaseUrl: 'https://abcd.supabase.co', photoOrigin: 'https://dirafoundationken.netlify.app' }) : null;
const server = http.createServer((q, r) => { const f = q.url.startsWith('/app.js') ? 'app.js' : 'index.html'; r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html', ...(csp ? { 'content-security-policy': csp } : {}) }); r.end(fs.readFileSync(path.join(out, f))); });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const results = []; const logs = [];
const EMAIL = 'new.learner@example.org', PASS = 'Kenya2026learn';
async function fresh(setup = {}) {
  const ctx = await browser.newContext(); const page = await ctx.newPage(); await page.clock.install();
  page.on('console', (m) => logs.push(m.text()));
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => { (window.__csp ??= []).push(e.violatedDirective + ' ' + e.blockedURI); }));
  await page.goto(base + '/signup');
  await page.evaluate((s) => Object.assign(window.__auth, s), setup);
  return { ctx, page };
}
async function register(page) {
  await page.getByLabel('Email address').fill(EMAIL);
  await page.locator('#su-password').fill(PASS); await page.getByLabel('Confirm password').fill(PASS);
  await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Create account' }).click();
  await page.getByRole('heading', { name: 'Check your email' }).waitFor();
  return page.evaluate((e) => window.__auth.outbox.filter((m) => m.to === e).at(-1).body, EMAIL);
}
// The verification link opens in the same browser profile (as when the learner taps it in their email app).
async function clickLink(page, link) { const state = await page.evaluate(() => window.__auth); await page.addInitScript((st) => {
  const s = { ...st, profiles: new Map(Object.entries(st.__profiles)), verifyTokens: new Map(Object.entries(st.__tokens)), confirmed: new Set(st.__confirmed), codes: new Map(), revoked: new Set() };
  window.__auth = s; }, { ...state, __profiles: Object.fromEntries(await page.evaluate(() => [...window.__auth.profiles])), __tokens: Object.fromEntries(await page.evaluate(() => [...window.__auth.verifyTokens])), __confirmed: await page.evaluate(() => [...window.__auth.confirmed]) });
  await page.goto('about:blank'); await page.goto(link); }   // opened fresh from the email, as a learner does
// keeps the simulated server state (users, profiles, confirmations) across the next page loads
async function persist(page) { const st = await page.evaluate(() => ({ ...window.__auth, __profiles: [...window.__auth.profiles], __tokens: [...window.__auth.verifyTokens], __confirmed: [...window.__auth.confirmed] }));
  await page.addInitScript((x) => { window.__auth = { ...x, profiles: new Map(x.__profiles), verifyTokens: new Map(x.__tokens), confirmed: new Set(x.__confirmed), codes: new Map(), revoked: new Set() }; }, st); }
const text = (page) => page.locator('body').innerText();
async function check(name, setup, fn) {
  const { ctx, page } = await fresh(setup);
  try { await fn(page); const v = await page.evaluate(() => window.__csp ?? []); if (v.length) throw new Error('CSP violations: ' + v.join('; ')); results.push([name, true]); }
  catch (e) { results.push([name, false, String(e.message ?? e).split('\n')[0] + ' | page: ' + (await text(page).catch(() => '')).slice(0, 160)]); }
  await ctx.close();
}

await check('registration -> verification link -> signed in -> dashboard (profile created by the database trigger)', {}, async (page) => {
  const link = await register(page);
  if (!/\/login#access_token=/.test(link)) throw new Error('verification link should return to /login with the session: ' + link);
  await clickLink(page, link);
  await page.getByRole('heading', { name: 'Dashboard (signed in)' }).waitFor({ timeout: 5000 });
  if (page.url().includes('access_token')) throw new Error('tokens left in the address bar');
  if (await page.evaluate(() => window.__auth.profiles.size) !== 1) throw new Error('expected exactly one profile');
});
await check('missing profile (database trigger absent): explained with PROFILE_MISSING, Try again and Sign out - never endless loading', { profileTrigger: false }, async (page) => {
  await clickLink(page, await register(page));
  await page.getByRole('heading', { name: 'Your account is not set up yet' }).waitFor({ timeout: 5000 });
  if (!(await text(page)).includes('PROFILE_MISSING')) throw new Error('no PROFILE_MISSING code');
  if (await page.getByRole('status').count()) throw new Error('loading text still shown');
  // the profile is repaired on the server (migration 36 back-fill) -> Try again reaches the dashboard without signing in again
  await page.evaluate(() => { const u = window.__auth.users.find((x) => !x.role); window.__auth.profiles.set(u.id, { role: 'applicant', status: 'active' }); });
  await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByRole('heading', { name: 'Dashboard (signed in)' }).waitFor({ timeout: 5000 });
});
await check('Sign out from the problem screen returns to sign-in', { profileTrigger: false }, async (page) => {
  await clickLink(page, await register(page));
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: /sign in/i }).first().waitFor({ timeout: 5000 });
});
await check('profile query error (e.g. a column missing in the live database): shown with its code 42703', {}, async (page) => {
  const link = await register(page); await page.evaluate(() => { window.__auth.profileMode = 'error42703'; }); await clickLink(page, link);
  await page.getByRole('heading', { name: 'We could not load your account' }).waitFor({ timeout: 5000 });
  if (!(await text(page)).includes('42703')) throw new Error('code not shown');
  if (/organization_id|column/.test(await text(page))) throw new Error('raw database message shown');
});
await check('network failure (request rejected): shown with code NETWORK', {}, async (page) => {
  const link = await register(page); await page.evaluate(() => { window.__auth.profileMode = 'reject'; }); await clickLink(page, link);
  await page.getByRole('heading', { name: 'We could not reach DIRA LEARN' }).waitFor({ timeout: 5000 });
  if (!(await text(page)).includes('NETWORK')) throw new Error('code not shown');
});
await check('HTTP 403 on profiles (the production failure, code 42501): explained as a server set-up problem with its code, Try again - never endless loading, never the dashboard', {}, async (page) => {
  const link = await register(page); await page.evaluate(() => { window.__auth.profileMode = 'forbidden'; }); await clickLink(page, link);
  await page.getByRole('heading', { name: 'DIRA LEARN could not open your account' }).waitFor({ timeout: 5000 });
  const t = await text(page);
  if (!t.includes('42501')) throw new Error('code not shown');
  if (/internet connection/i.test(t)) throw new Error('blames the connection');
  if (/permission denied for table/.test(t)) throw new Error('raw database message shown');
  if (/Loading your account/.test(t)) throw new Error('still loading');
  await page.getByRole('button', { name: 'Try again' }).waitFor({ timeout: 2000 });
  await page.evaluate(() => { window.__auth.profileMode = 'ok'; }); await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByRole('heading', { name: /dashboard|welcome/i }).first().waitFor({ timeout: 5000 });
});
await check('expired sign-in (PGRST301): "Your sign-in has expired" with Sign in again, which returns to sign-in', {}, async (page) => {
  const link = await register(page); await page.evaluate(() => { window.__auth.profileMode = 'expired'; }); await clickLink(page, link);
  await page.getByRole('heading', { name: 'Your sign-in has expired' }).waitFor({ timeout: 5000 });
  if (await page.getByRole('button', { name: 'Try again' }).count()) throw new Error('offers Try again for an expired sign-in');
  await page.getByRole('button', { name: 'Sign in again' }).click();
  await page.waitForURL(/\/login/, { timeout: 5000 });
});
await check('a request that never answers: waiting text, then TIMEOUT after 15 s, then Try again succeeds', {}, async (page) => {
  const link = await register(page); await page.evaluate(() => { window.__auth.profileMode = 'hang'; }); await clickLink(page, link);
  await page.getByRole('status').filter({ hasText: 'Loading your account' }).waitFor({ timeout: 5000 });
  await page.clock.runFor(16_000);
  await page.getByRole('heading', { name: 'We could not reach DIRA LEARN' }).waitFor({ timeout: 5000 });
  if (!(await text(page)).includes('TIMEOUT')) throw new Error('no TIMEOUT');
  await page.evaluate(() => { window.__auth.profileMode = 'ok'; }); await page.getByRole('button', { name: 'Try again' }).click();
  await page.getByRole('heading', { name: 'Dashboard (signed in)' }).waitFor({ timeout: 5000 });
});
await check('inactive account (migration 34 refusal): "not active" message, no access', {}, async (page) => {
  const link = await register(page); await page.evaluate(() => { window.__auth.profileMode = 'inactive'; }); await clickLink(page, link);
  await page.getByText(/This account is not active/).waitFor({ timeout: 5000 });
  if (await page.getByRole('heading', { name: 'Dashboard (signed in)' }).count()) throw new Error('dashboard shown');
});
await check('sign-in with password after verification reaches the dashboard; before verification it is refused', {}, async (page) => {
  let step = 'register';
  try {
    const link = await register(page);
    step = 'sign-in before verification is refused'; await persist(page);
    await page.goto(base + '/login'); await page.getByLabel('Email address').fill(EMAIL); await page.locator('#login-password').fill(PASS);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('alert').filter({ hasText: /not confirmed/i }).waitFor({ timeout: 5000 });
    step = 'verification link'; await clickLink(page, link); await page.getByRole('heading', { name: 'Dashboard (signed in)' }).waitFor({ timeout: 5000 });
    step = 'sign out on this device'; await persist(page); await page.evaluate(() => localStorage.removeItem('fake-session')); await page.goto(base + '/login');
    step = 'sign-in with password'; await page.getByLabel('Email address').fill(EMAIL); await page.locator('#login-password').fill(PASS);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('heading', { name: 'Dashboard (signed in)' }).waitFor({ timeout: 5000 });
  } catch (e) { throw new Error(`[${step}] ` + (e.message ?? e)); }
});
await check('token refresh keeps the page: no reload of the profile, no waiting screen', {}, async (page) => {
  await clickLink(page, await register(page)); await page.getByRole('heading', { name: 'Dashboard (signed in)' }).waitFor({ timeout: 5000 });
  const before = await page.evaluate(() => window.__auth.profileQueries);
  await page.evaluate(() => window.__refresh()); await page.clock.runFor(500);
  const after = await page.evaluate(() => window.__auth.profileQueries);
  if (after !== before) throw new Error(`profile loaded again on token refresh (${before} -> ${after})`);
  await page.getByRole('heading', { name: 'Dashboard (signed in)' }).waitFor({ timeout: 2000 });
});
await check('registering again with the same address creates no second account or profile', {}, async (page) => {
  await register(page); await page.goto(base + '/signup'); await register(page).catch(() => {});
  const n = await page.evaluate((e) => [window.__auth.users.filter((u) => u.email === e).length, window.__auth.profiles.size], EMAIL);
  if (n[0] !== 1 || n[1] !== 1) throw new Error('users/profiles: ' + n);
});
const leaked = logs.filter((l) => /tok-|verify-|access_token|Kenya2026/.test(l));
results.push(['no token, verification link or password in the browser console', leaked.length === 0, leaked.join(' | ').slice(0, 200)]);
await browser.close(); server.close();
for (const [n, ok, why] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${ok ? '' : '  -> ' + why}`);
console.log(`registration, verification and account loading in Chrome (simulated Supabase${csp ? ', production Content-Security-Policy' : ''}): ${results.filter((r) => r[1]).length}/${results.length} checks passed`);
process.exit(results.every((r) => r[1]) ? 0 : 1);
