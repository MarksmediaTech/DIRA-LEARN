// Browser tests of the password-recovery screens in Chrome, against the SIMULATED Supabase Auth in fake-supabase.ts.
// Usage: node run.mjs <project>   (builds the harness, serves it, runs the tests). Real Supabase: see e2e/password-recovery.spec.ts.
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { execFileSync } from 'node:child_process';
const proj = process.argv[2]; const here = path.dirname(new URL(import.meta.url).pathname);
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'recovery-ui-'));
execFileSync('node', [path.join(here, 'build.mjs'), proj, out], { stdio: 'inherit' });
fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
// With RECOVERY_CSP=1 the screens are served with the production Content-Security-Policy (scripts/write-headers.mjs)
// and every policy violation fails the run: the real React screens must work under the policy.
const csp = process.env.RECOVERY_CSP ? (await import(path.join(path.resolve(proj), 'scripts', 'write-headers.mjs'))).buildCsp({ supabaseUrl: 'https://abcd.supabase.co', photoOrigin: 'https://dirafoundationken.netlify.app' }) : null;   // as built while no photos are stored in /photos
const server = http.createServer((q, r) => { const f = q.url === '/app.js' ? 'app.js' : 'index.html'; r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html', ...(csp ? { 'content-security-policy': csp } : {}) }); r.end(fs.readFileSync(path.join(out, f))); });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${server.address().port}`;
const exe = fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined;
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const results = []; const consoleLines = []; const secrets = new Set(['learn-2026-new', 'staff-2026-new', 'DiraTest!2026']);
const USERS = [{ id: 'u-learner', email: 'learner1@dira-test.local', password: 'DiraTest!2026', role: 'participant' },
               { id: 'u-founder', email: 'founder@dira-test.local', password: 'DiraTest!2026', role: 'founder' }];
const GENERIC = 'If an account exists for this email address, we have sent a password reset code to it.';

async function fresh() {
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.clock.install();
  await page.addInitScript((users) => { window.__seed = users; }, USERS);
  await page.addInitScript(() => { const m = window.__seed; Object.defineProperty(window, '__auth', { configurable: true, writable: true, value: undefined });
    window.__authSeed = m; });
  page.on('console', (m) => consoleLines.push(m.text()));
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => { (window.__csp ??= []).push(e.violatedDirective + ' ' + e.blockedURI); }));

  await page.goto(base + '/login');
  await page.evaluate(() => { window.__auth.users.push(...window.__authSeed.map((u) => ({ ...u }))); });
  return { ctx, page };
}
const latestCode = (page, email) => page.evaluate((e) => { const m = [...window.__auth.outbox].reverse().find((x) => x.to === e); if (m) window.__codes = (window.__codes ?? []).concat(m.body.match(/\d{6}/)[0]); return m ? m.body.match(/\d{6}/)[0] : null; }, email);
const outboxCount = (page) => page.evaluate(() => window.__auth.outbox.length);
async function requestCode(page, email) {
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send reset code' }).click();
  await page.getByRole('heading', { name: 'Check your email' }).waitFor();
}
async function enterCode(page, code) { await page.getByLabel('Reset code').fill(code); await page.getByRole('button', { name: 'Verify code' }).click(); }
async function test(name, fn) {
  const { ctx, page } = await fresh();
  try { await fn(page);
        const v = await page.evaluate(() => window.__csp ?? []).catch(() => []);
        if (v.length) throw new Error('Content-Security-Policy violations: ' + v.join('; '));
        results.push([name, true]); } catch (e) { results.push([name, false, String(e.message ?? e).split('\n')[0] + (process.env.DEBUG ? ' | URL ' + page.url() + ' | PAGE: ' + (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 400) : '')]); }
  await ctx.close();
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const alertText = async (page) => (await page.getByRole('alert').first().textContent({ timeout: 3000 }))?.trim() ?? '';

await test('the sign-in page links to a working Forgot password screen (no more "contact the administrator" message)', async (p) => {
  expect(!(await p.content()).includes('Self-service password reset is not available'), 'old message still shown');
  await p.getByRole('link', { name: 'Forgot password?' }).click();
  await p.getByRole('heading', { name: 'Forgot your password?' }).waitFor();
});
await test('an unknown and a registered address get exactly the same message; only the registered one is emailed', async (p) => {
  await requestCode(p, 'nobody@example.org');
  const a = await p.getByRole('status').first().textContent(); expect(a.includes(GENERIC), 'generic message missing');
  expect(await outboxCount(p) === 0, 'an email was sent to an unknown address');
  await p.getByRole('button', { name: 'Back to sign in' }).click();
  await requestCode(p, 'Learner1@Dira-Test.local ');
  const b = await p.getByRole('status').first().textContent();
  expect(a === b, 'messages differ between unknown and registered addresses');
  expect(await outboxCount(p) === 1 && (await latestCode(p, 'learner1@dira-test.local')), 'no code emailed to the registered address');
});
await test('learner: wrong code refused, correct code verified, mismatch and weak passwords refused, new password saved, back to sign in', async (p) => {
  await requestCode(p, 'learner1@dira-test.local'); const code = await latestCode(p, 'learner1@dira-test.local');
  await enterCode(p, code === '111111' ? '222222' : '111111'); expect((await alertText(p)).includes('not correct or has expired'), 'wrong code not refused');
  await enterCode(p, code.slice(0, 3) + ' ' + code.slice(3)); await p.getByRole('heading', { name: 'Choose a new password' }).waitFor();
  await p.locator('#fp-password').fill('learn-2026-new'); await p.getByLabel('Confirm new password').fill('learn-2026-other');
  await p.getByRole('button', { name: 'Save new password' }).click(); expect((await alertText(p)).includes('do not match'), 'mismatch not refused');
  await p.locator('#fp-password').fill('short1'); await p.getByLabel('Confirm new password').fill('short1');
  await p.getByRole('button', { name: 'Save new password' }).click(); expect((await alertText(p)).includes('at least 10'), 'weak password not refused');
  expect(await p.locator('#fp-password').getAttribute('type') === 'password', 'password visible by default');
  await p.getByRole('button', { name: /Show/ }).click(); expect(await p.locator('#fp-password').getAttribute('type') === 'text', 'show control does not work');
  await p.locator('#fp-password').fill('learn-2026-new'); await p.getByLabel('Confirm new password').fill('learn-2026-new');
  await p.getByRole('button', { name: 'Save new password' }).click();
  await p.getByRole('heading', { name: 'Welcome Back' }).waitFor();
  expect((await p.getByRole('status').first().textContent()).includes('Your password has been changed'), 'no confirmation on the sign-in page');
  expect(await p.evaluate(() => !localStorage.getItem('fake-session') && !localStorage.getItem('dira.recovery.pending')), 'recovery session left behind');
  await p.getByLabel('Email address').fill('learner1@dira-test.local'); await p.locator('#login-password').fill('DiraTest!2026');
  await p.getByRole('button', { name: 'Sign in' }).click(); await p.getByRole('alert').waitFor();
  await p.locator('#login-password').fill('learn-2026-new'); await p.getByRole('button', { name: 'Sign in' }).click();
  await p.getByRole('heading', { name: 'Dashboard (signed in)' }).waitFor();
});
await test('a used code cannot be used again', async (p) => {
  await requestCode(p, 'learner1@dira-test.local'); const code = await latestCode(p, 'learner1@dira-test.local');
  await enterCode(p, code); await p.getByRole('heading', { name: 'Choose a new password' }).waitFor();
  await p.getByRole('button', { name: 'Back to sign in' }).click(); await p.getByRole('heading', { name: 'Welcome Back' }).waitFor();
  await p.getByRole('link', { name: 'Forgot password?' }).click(); await p.getByLabel('Email address').fill('learner1@dira-test.local');
  await p.getByRole('button', { name: 'Send reset code' }).click(); await p.getByRole('heading', { name: 'Check your email' }).waitFor();
  await enterCode(p, code); expect((await alertText(p)).includes('not correct or has expired'), 'a used code was accepted');
});
await test('an expired code (after 15 minutes) is refused', async (p) => {
  await requestCode(p, 'learner1@dira-test.local'); const code = await latestCode(p, 'learner1@dira-test.local');
  await p.clock.fastForward('16:00');
  await enterCode(p, code); expect((await alertText(p)).includes('not correct or has expired'), 'expired code accepted');
});
await test('resend: disabled with a countdown for 60 seconds, then a new code replaces the old one', async (p) => {
  await requestCode(p, 'learner1@dira-test.local'); const first = await latestCode(p, 'learner1@dira-test.local');
  const btn = p.getByRole('button', { name: /Send a new code/ });
  expect(await btn.isDisabled() && /in \d+s/.test(await btn.textContent()), 'resend not on cooldown');
  await p.clock.fastForward('01:01'); await p.getByRole('button', { name: 'Send a new code', exact: true }).waitFor();
  await p.getByRole('button', { name: 'Send a new code', exact: true }).click();
  await p.waitForFunction(() => window.__auth.outbox.length === 2);
  let second = await latestCode(p, 'learner1@dira-test.local'); expect(second, 'no second code');
  if (second === first) throw new Error('same code twice (random clash) - rerun');
  await enterCode(p, first); expect((await alertText(p)).includes('not correct or has expired'), 'the replaced code still works');
  await enterCode(p, second); await p.getByRole('heading', { name: 'Choose a new password' }).waitFor();
});
await test('repeated guessing: after 5 wrong codes the screen requires a new code', async (p) => {
  await requestCode(p, 'learner1@dira-test.local');
  for (let i = 0; i < 5; i++) { await enterCode(p, '00000' + i); await p.getByRole('alert').waitFor(); }
  expect(await p.getByRole('button', { name: 'Verify code' }).isDisabled(), 'verify still enabled after 5 wrong codes');
});
await test('server rate limit on code checks is explained', async (p) => {
  await requestCode(p, 'learner1@dira-test.local'); await p.evaluate(() => { window.__auth.verifyLimit = 2; });
  for (let i = 0; i < 3; i++) await enterCode(p, '99999' + i);
  expect((await alertText(p)).includes('Too many attempts'), 'rate limit not explained');
});
await test('a verified recovery cannot be used to open DIRA LEARN: other pages send the person back to the new-password step', async (p) => {
  await requestCode(p, 'learner1@dira-test.local'); await enterCode(p, await latestCode(p, 'learner1@dira-test.local'));
  await p.getByRole('heading', { name: 'Choose a new password' }).waitFor();
  await p.evaluate(() => { history.pushState({}, '', '/'); dispatchEvent(new PopStateEvent('popstate')); });
  await p.getByRole('heading', { name: 'Choose a new password' }).waitFor();
  expect(!(await p.getByRole('heading', { name: 'Dashboard (signed in)' }).count()), 'dashboard opened during recovery');
  await p.getByRole('button', { name: 'Back to sign in' }).click(); await p.getByRole('heading', { name: 'Welcome Back' }).waitFor();
  expect(await p.evaluate(() => !localStorage.getItem('fake-session')), 'cancelling left the recovery session signed in');
});
await test('the new-password step cannot be reached without verifying a code', async (p) => {
  await p.evaluate(() => { localStorage.setItem('dira.recovery.pending', '1'); });
  await p.getByRole('link', { name: 'Forgot password?' }).click();
  await p.getByRole('heading', { name: 'Forgot your password?' }).waitFor();
  expect(!(await p.locator('#fp-password').count()), 'password form shown without verification');
});
await test('staff (Founder) use exactly the same screens; the account keeps its role', async (p) => {
  await requestCode(p, 'founder@dira-test.local'); await enterCode(p, await latestCode(p, 'founder@dira-test.local'));
  await p.locator('#fp-password').fill('staff-2026-new'); await p.getByLabel('Confirm new password').fill('staff-2026-new');
  await p.getByRole('button', { name: 'Save new password' }).click(); await p.getByRole('heading', { name: 'Welcome Back' }).waitFor();
  await p.getByLabel('Email address').fill('founder@dira-test.local'); await p.locator('#login-password').fill('staff-2026-new');
  await p.getByRole('button', { name: 'Sign in' }).click(); await p.getByRole('heading', { name: 'Dashboard (signed in)' }).waitFor();
  expect(await p.evaluate(() => window.__auth.users.find((u) => u.email === 'founder@dira-test.local').role === 'founder'), 'role changed');
});
const codesSeen = consoleLines.join('\n');
results.push(['nothing written to the browser console contains a code or a password',
  ![...secrets].some((s) => codesSeen.includes(s)) && !/\b\d{6}\b/.test(codesSeen)]);
await browser.close(); server.close();
const failed = results.filter((r) => !r[1]);
console.log(`password recovery screens in Chrome (simulated Supabase Auth${csp ? ', production Content-Security-Policy' : ''}): ${results.length - failed.length}/${results.length} checks passed`);
for (const f of failed) console.log('  FAILED ' + f[0] + (f[2] ? ' - ' + f[2] : ''));
process.exit(failed.length ? 1 : 0);
