// Direct CSV enrolment in Chrome (22 Nov 2026): the REAL ImportPage, SetPasswordPage, LoginPage, AuthProvider and ProtectedRoute
// with the SIMULATED Supabase in fake-supabase.ts (the Edge Functions themselves are tested in tools/edge-browser/run.mjs).
// Also reproduces the reported "j.json is not a function" with the Import page as released on 21 Nov 2026, and shows it gone.
// Usage: node enrolment_flow.mjs <project>   (RECOVERY_CSP=1: served with the production Content-Security-Policy)
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { execFileSync } from 'node:child_process';
const proj = process.argv[2]; const here = path.dirname(new URL(import.meta.url).pathname);
const bundle = (entry) => { const out = fs.mkdtempSync(path.join(os.tmpdir(), 'enrol-')); execFileSync('node', [path.join(here, 'build.mjs'), proj, out], { stdio: 'inherit', env: { ...process.env, HARNESS_ENTRY: entry } });
  fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'); return out; };
const NEW = bundle('harness.tsx'); const OLD = bundle('harness-before-22nov.tsx');
const csp = process.env.RECOVERY_CSP ? (await import(path.join(path.resolve(proj), 'scripts', 'write-headers.mjs'))).buildCsp({ supabaseUrl: 'https://abcd.supabase.co', photoOrigin: 'https://dirafoundationken.netlify.app' }) : null;
const serve = async (dir) => { const srv = http.createServer((q, r) => { const f = q.url.startsWith('/app.js') ? 'app.js' : 'index.html'; r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : 'text/html', ...(csp ? { 'content-security-policy': csp } : {}) }); r.end(fs.readFileSync(path.join(dir, f))); });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok)); return { srv, base: `http://127.0.0.1:${srv.address().port}` }; };
const sNew = await serve(NEW); const sOld = await serve(OLD);
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const results = []; const logs = [];
const COORD = { id: 'u-coord', email: 'coord@dira-test.local', password: 'DiraTest2026', role: 'programme_coordinator' };

async function open(base, setup) {
  const ctx = await browser.newContext(); const page = await ctx.newPage(); const errors = [];
  page.on('console', (m) => logs.push(m.text())); page.on('pageerror', (e) => errors.push(String(e.message)));
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', (e) => { (window.__csp ??= []).push(e.violatedDirective + ' ' + e.blockedURI); }));
  await page.goto(base + '/start');   // no route: nothing redirects while the test prepares the simulated server
  await page.evaluate(setup ?? (() => {}));
  return { ctx, page, errors };
}
const go = (p, to) => p.evaluate((t) => { history.pushState({ usr: null }, '', t); dispatchEvent(new PopStateEvent('popstate')); }, to);
const text = (p) => p.locator('body').innerText();
const expect = (c, m) => { if (!c) throw new Error(m); };
async function check(name, base, setup, fn) {
  const { ctx, page, errors } = await open(base, setup);
  try { await fn(page, errors); const v = await page.evaluate(() => window.__csp ?? []); if (v.length) throw new Error('CSP violations: ' + v.join('; ')); results.push([name, true]); }
  catch (e) { results.push([name, false, String(e.message ?? e).split('\n')[0] + ' | page: ' + (await text(page).catch(() => '')).replace(/\s+/g, ' ').slice(0, 260)]); }
  await ctx.close();
}
const asCoordinator = () => { window.__auth.users.push({ id: 'u-coord', email: 'coord@dira-test.local', password: 'DiraTest2026', role: 'programme_coordinator' }); };
async function upload(p, csv, name = 'learners.csv') {
  await p.locator('input[type=file]').setInputFiles({ name, mimeType: 'text/csv', buffer: Buffer.from(csv) });
  // the page reads the file asynchronously: wait until it shows either the preview or a file error
  await p.locator('text=/rows are ready|The first row must|has columns that are not used|appears twice|is empty|no learners/').first().waitFor({ timeout: 5000 });
}
const VALID = 'name,email,programme_track\nMary Wanjiku,mary@example.com,AI Tools\nJohn Otieno,john@example.com,content creation\n';
async function importPage(p) { await go(p, '/import'); await p.getByRole('heading', { name: 'Add learners' }).waitFor(); await p.locator('strong', { hasText: 'Entrepreneurship & Business' }).waitFor(); }   // tracks loaded
async function send(p) { p.once('dialog', (d) => d.accept()); await p.getByRole('button', { name: /^Send \d+ invitations$/ }).click(); }

// ---------- the reported error ----------
await check('BEFORE the fix (page as released 21 Nov): a network/CORS failure of import-learners crashed the handler with "ctx.json is not a function" (minified: "j.json is not a function")', sOld.base,
  () => { window.__auth.importMode = 'unreachable'; }, async (p) => {
    await go(p, '/import'); await p.getByRole('heading', { name: 'Import learners' }).waitFor();
    await upload(p, 'first_name,last_name,email\nMary,Wanjiku,mary@example.com\n'); p.once('dialog', (d) => d.accept());
    await p.getByRole('button', { name: /^Send 1 invitations$/ }).click();
    await p.getByText(/json is not a function/).waitFor({ timeout: 5000 });
  });
await check('AFTER the fix: the same failure shows a clear message (unknown outcome, check Earlier imports) and no "json is not a function"', sNew.base,
  () => { window.__auth.users.push({ id: 'u-coord', email: 'c@x', password: 'DiraTest2026', role: 'programme_coordinator' }); window.__auth.importMode = 'unreachable'; }, async (p, errors) => {
    await importPage(p); await upload(p, VALID); await send(p);
    const a = p.getByRole('alert'); await a.waitFor(); const t = await a.textContent();
    expect(/No answer was received from the server function/.test(t) && /check "Earlier imports"/.test(t), t);
    expect(!/json is not a function/.test(await text(p)) && !errors.some((e) => /json/.test(e)), 'json error still visible');
    expect(!(await text(p)).includes('invitations sent'), 'shown as successful');
    expect(await p.getByRole('button', { name: /^Send 2 invitations$/ }).count() === 1, 'the rows were cleared after a failure');
  });
await check('a refusal by the function (HTTP 403 with a JSON error) shows the function\'s message and is not shown as success', sNew.base,
  () => { window.__auth.importMode = 'forbidden'; }, async (p) => {
    await importPage(p); await upload(p, VALID); await send(p);
    expect((await p.getByRole('alert').textContent()) === 'The import did not run: Forbidden', await p.getByRole('alert').textContent());
    expect(!(await text(p)).includes('invitations sent'), 'shown as successful');
  });
await check('a non-JSON server error (HTTP 502 page) shows the status, no crash', sNew.base, () => { window.__auth.importMode = 'html502'; }, async (p) => {
  await importPage(p); await upload(p, VALID); await send(p); expect(/HTTP 502/.test(await p.getByRole('alert').textContent()), 'no status');
});
await check('an unexpected success answer is not shown as success', sNew.base, () => { window.__auth.importMode = 'unexpected'; }, async (p) => {
  await importPage(p); await upload(p, VALID); await send(p); expect(/unexpected answer/.test(await p.getByRole('alert').textContent()), 'accepted');
});

// ---------- CSV checks in the page ----------
await check('valid CSV: preview shows name, email and programme track; Send posts exactly name, email, programme_track (canonical track names)', sNew.base, null, async (p) => {
  await importPage(p); await upload(p, VALID);
  const t = await text(p); expect(t.includes('2 of 2 rows are ready'), 'count'); expect(/Mary Wanjiku\s+mary@example.com\s+AI Tools\s+Ready/.test(t) && /John Otieno\s+john@example.com\s+Content Creation\s+Ready/.test(t), 'preview');
  await send(p); await p.getByText(/2.*invitations sent/).waitFor();
  const sent = await p.evaluate(() => window.__auth.importCalls[0].rows);
  expect(JSON.stringify(sent) === JSON.stringify([{ name: 'Mary Wanjiku', email: 'mary@example.com', programme_track: 'AI Tools' }, { name: 'John Otieno', email: 'john@example.com', programme_track: 'Content Creation' }]), JSON.stringify(sent));
});
await check('a CSV with a missing column is rejected with a clear message and nothing can be sent', sNew.base, null, async (p) => {
  await importPage(p); await upload(p, 'name,email\nMary Wanjiku,mary@example.com\n');
  expect(/exactly these columns: name, email, programme_track\. Missing: programme_track/.test(await p.getByRole('alert').textContent()), 'message');
  expect(await p.getByRole('button', { name: /^Send/ }).count() === 0, 'send offered');
});
await check('invalid email, unknown track ("Digital Skills") and duplicate email are flagged per row and skipped; only valid rows are sent', sNew.base, null, async (p) => {
  await importPage(p);
  await upload(p, 'name,email,programme_track\nBrian Njima,brian@example.com,Digital Skills\nMary Wanjiku,mary@example.com,AI Tools\nJoy Achieng,not-an-email,AI Tools\nMary Again,MARY@example.com,AI Tools\n');
  const t = await text(p);
  expect(t.includes('1 of 4 rows are ready') && t.includes('"Digital Skills" is not a programme track in DIRA LEARN') && t.includes('The email address is not valid.') && t.includes('Same email as row 3.'), t.slice(0, 400));
  await send(p); await p.getByText(/1.*invitations sent/).waitFor();
  expect(JSON.stringify(await p.evaluate(() => window.__auth.importCalls[0].rows.map((r) => r.email))) === '["mary@example.com"]', 'invalid rows were sent');
});
await check('the downloadable template has exactly name, email, programme_track with valid tracks', sNew.base, null, async (p) => {
  await importPage(p); const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('button', { name: 'Download a template' }).click()]);
  const body = fs.readFileSync(await dl.path(), 'utf8'); expect(body.startsWith('name,email,programme_track\n') && body.includes(',Digital Marketing\n') && body.includes(',AI Tools\n'), body);
});

// ---------- Add one learner (individual enrolment, same function and activation as CSV) ----------
async function addOne(p, { name, email, track }, accept = true) {
  if (name !== undefined) await p.getByLabel(/^Name/).fill(name);
  if (email !== undefined) await p.getByLabel(/^Email/).fill(email);
  if (track) await p.getByLabel(/Programme track/).selectOption({ label: track });
  let asked = null; p.once('dialog', (d) => { asked = d.message(); void (accept ? d.accept() : d.dismiss()); });
  await p.getByRole('button', { name: 'Add learner and send invitation' }).click(); await p.waitForTimeout(300);
  return asked;
}
await check('Add learner: the track list is exactly the configured tracks; a valid learner is confirmed, then sent as ONE row to the same import function', sNew.base, null, async (p) => {
  await importPage(p);
  const opts = await p.getByLabel(/Programme track/).locator('option').allTextContents();
  expect(JSON.stringify(opts) === JSON.stringify(['Choose…', 'Digital Marketing', 'AI Tools', 'Content Creation', 'Entrepreneurship & Business']), JSON.stringify(opts));
  const asked = await addOne(p, { name: '  Grace  Akinyi ', email: 'GRACE@Example.com', track: 'Entrepreneurship & Business' });
  expect(/Send an invitation to Grace Akinyi \(grace@example.com\), track Entrepreneurship & Business\?/.test(asked ?? ''), 'confirmation: ' + asked);
  await p.getByText(/Invitation sent to grace@example.com \(Entrepreneurship & Business\)/).waitFor();
  const calls = await p.evaluate(() => window.__auth.importCalls);
  expect(calls.length === 1 && calls[0].fileName === 'Added on the dashboard' && JSON.stringify(calls[0].rows) === '[{"name":"Grace Akinyi","email":"grace@example.com","programme_track":"Entrepreneurship & Business"}]', JSON.stringify(calls));
  expect(await p.getByLabel(/^Name/).inputValue() === '', 'form not cleared');
});
await check('Add learner: cancelling the confirmation sends nothing', sNew.base, null, async (p) => {
  await importPage(p); await addOne(p, { name: 'Grace Akinyi', email: 'grace@example.com', track: 'AI Tools' }, false);
  expect((await p.evaluate(() => window.__auth.importCalls.length)) === 0, 'sent');
});
await check('Add learner: every field is required and the email is validated, with clear messages and nothing sent', sNew.base, null, async (p) => {
  await importPage(p);
  const msgs = [];
  await addOne(p, { name: '', email: 'g@example.com', track: 'AI Tools' }); msgs.push(await p.getByRole('alert').textContent());
  await addOne(p, { name: 'Grace Akinyi', email: '' }); msgs.push(await p.getByRole('alert').textContent());
  await addOne(p, { email: 'not-an-email' }); msgs.push(await p.getByRole('alert').textContent());
  await p.getByLabel(/Programme track/).selectOption({ label: 'Choose…' }); await addOne(p, { email: 'g@example.com' }); msgs.push(await p.getByRole('alert').textContent());
  expect(JSON.stringify(msgs) === JSON.stringify(["Enter the learner's name.", "Enter the learner's email address.", 'The email address is not valid.', 'Choose the programme track.']), JSON.stringify(msgs));
  expect((await p.evaluate(() => window.__auth.importCalls.length)) === 0, 'sent');
});
await check('Add learner: an existing account is reported, not changed and not enrolled', sNew.base, () => { window.__auth.existingEmails = ['old@example.com']; }, async (p) => {
  await importPage(p); await addOne(p, { name: 'Old User', email: 'old@example.com', track: 'AI Tools' });
  expect(/old@example.com already has an account, so nothing was changed and the learner was not enrolled/.test(await p.getByRole('alert').textContent()), 'message');
  expect(!(await text(p)).includes('Invitation sent'), 'shown as sent');
});
await check('Add learner: a learner invited earlier but not activated is told apart (invitation sent again, no second enrolment)', sNew.base, () => { window.__auth.pendingEmails = ['grace@example.com']; }, async (p) => {
  await importPage(p); await addOne(p, { name: 'Grace Akinyi', email: 'grace@example.com', track: 'AI Tools' });
  await p.getByText(/Already invited earlier, not yet activated: invitation sent to grace@example.com/).waitFor();
});
await check('Add learner: if the function cannot be reached, the page says the outcome is unknown (no "json is not a function", not shown as sent)', sNew.base, () => { window.__auth.importMode = 'unreachable'; }, async (p, errors) => {
  await importPage(p); await addOne(p, { name: 'Grace Akinyi', email: 'grace@example.com', track: 'AI Tools' });
  const t = await p.getByRole('alert').textContent();
  expect(/No answer was received/.test(t) && /not known whether the invitation was sent/.test(t), t);
  expect(!/json is not a function/.test(await text(p)) && !errors.length && !(await text(p)).includes('Invitation sent to'), 'wrong outcome');
});
await check('Add learner: a refusal (HTTP 403) shows the function\'s message', sNew.base, () => { window.__auth.importMode = 'forbidden'; }, async (p) => {
  await importPage(p); await addOne(p, { name: 'Grace Akinyi', email: 'grace@example.com', track: 'AI Tools' });
  expect((await p.getByRole('alert').textContent()) === 'The learner was not added: Forbidden', await p.getByRole('alert').textContent());
});
await check('the menu entry for the page is "Add learners" and the CSV import is still on the same page', sNew.base, null, async (p) => {
  await importPage(p); await p.getByRole('heading', { name: 'Import from a CSV file' }).waitFor(); await p.getByRole('heading', { name: 'Add one learner' }).waitFor();
});
// a learner added on the dashboard is activated exactly like an imported one (the account carries the same server-side record)
const invitedSingle = `(() => { const a = window.__auth; a.users.push({ id: 'u-grace', email: 'grace@example.com', password: '', role: '' }); a.profiles.set('u-grace', { role: 'applicant', status: 'active' });
  a.meta.set('u-grace', { dira_enrolment: { track_id: 't-eb', track_name: 'Entrepreneurship & Business', invited_by: 'u-coord' } }); window.__inviteLanding('u-grace'); })()`;
await check('a learner added with the form sets the first password and is immediately an active participant (track Entrepreneurship & Business, no cohort)', sNew.base, invitedSingle, async (p) => {
  await go(p, '/set-password'); await p.locator('#sp-password').fill('Grace-Learner-2026'); await p.getByLabel('Confirm password').fill('Grace-Learner-2026');
  await p.getByRole('button', { name: 'Save password' }).click(); await p.getByText('your participant account is active').waitFor();
  const parts = await p.evaluate(() => window.__auth.participants);
  expect(JSON.stringify(parts) === '[{"profile_id":"u-grace","programme_track_id":"t-eb"}]', JSON.stringify(parts));
  await p.getByTestId('role').filter({ hasText: 'participant' }).waitFor({ timeout: 5000 });
});

// ---------- invitation link -> password -> participant ----------
const invited = `(() => { const a = window.__auth; a.users.push({ id: 'u-mary', email: 'mary@example.com', password: '', role: '' }); a.profiles.set('u-mary', { role: 'applicant', status: 'active' });
  a.meta.set('u-mary', { dira_enrolment: { track_id: 't-ai', track_name: 'AI Tools', invited_by: 'u-coord' } }); window.__inviteLanding('u-mary'); })()`;
await check('the invitation link opens the password page; setting the first password makes the learner an active participant with track AI Tools and no cohort, then the dashboard', sNew.base, invited, async (p) => {
  await go(p, '/set-password'); await p.getByRole('heading', { name: 'Choose your password' }).waitFor();
  expect(await p.evaluate(() => window.__auth.profiles.get('u-mary').role) === 'applicant', 'activated before the password');
  await p.locator('#sp-password').fill('Mary-Learner-2026'); await p.getByLabel('Confirm password').fill('Mary-Learner-2026');
  await p.getByRole('button', { name: 'Save password' }).click();
  await p.getByText('your participant account is active').waitFor();
  const st = await p.evaluate(() => ({ role: window.__auth.profiles.get('u-mary').role, parts: window.__auth.participants, pw: window.__auth.users.find((u) => u.id === 'u-mary').password, calls: window.__auth.invokes }));
  expect(st.role === 'participant' && st.pw === 'Mary-Learner-2026', JSON.stringify(st));
  expect(JSON.stringify(st.parts) === '[{"profile_id":"u-mary","programme_track_id":"t-ai"}]', 'participant/track: ' + JSON.stringify(st.parts));
  await p.getByTestId('role').filter({ hasText: 'participant' }).waitFor({ timeout: 5000 });
});
await check('the learner can sign out and sign in again with the new password and lands on the participant dashboard', sNew.base, invited, async (p) => {
  await go(p, '/set-password'); await p.locator('#sp-password').fill('Mary-Learner-2026'); await p.getByLabel('Confirm password').fill('Mary-Learner-2026');
  await p.getByRole('button', { name: 'Save password' }).click(); await p.getByText('your participant account is active').waitFor();
  await p.evaluate(() => window.__signOut()); await go(p, '/login');
  await p.getByLabel('Email address').fill('mary@example.com'); await p.locator('#login-password').fill('Mary-Learner-2026'); await p.getByRole('button', { name: 'Sign in' }).click();
  await p.getByTestId('role').filter({ hasText: 'participant' }).waitFor({ timeout: 5000 });
  expect(await p.evaluate(() => window.__auth.participants.length) === 1, 'second participant');
});
await check('if activation cannot reach the server, the page says so (password kept), offers Try again, and activation then succeeds', sNew.base, invited + "; window.__auth.enrolMode = 'down';", async (p) => {
  await go(p, '/set-password'); await p.locator('#sp-password').fill('Mary-Learner-2026'); await p.getByLabel('Confirm password').fill('Mary-Learner-2026');
  await p.getByRole('button', { name: 'Save password' }).click();
  await p.getByText('Your participant account could not be activated yet').waitFor();
  expect(/No answer was received/.test(await p.getByRole('alert').textContent()), 'message');
  expect(await p.evaluate(() => window.__auth.profiles.get('u-mary').role) === 'applicant', 'shown as failed but activated');
  await p.evaluate(() => { window.__auth.enrolMode = 'ok'; }); await p.getByRole('button', { name: 'Try again' }).click();
  await p.getByText('your participant account is active').waitFor();
});
await check('if the learner left after a failed activation, signing in with the password finishes it automatically', sNew.base, invited + "; window.__auth.enrolMode = 'down';", async (p) => {
  await go(p, '/set-password'); await p.locator('#sp-password').fill('Mary-Learner-2026'); await p.getByLabel('Confirm password').fill('Mary-Learner-2026');
  await p.getByRole('button', { name: 'Save password' }).click(); await p.getByText('Your participant account could not be activated yet').waitFor();
  await p.evaluate(() => { window.__auth.enrolMode = 'ok'; return window.__signOut(); }); await go(p, '/login');
  await p.getByLabel('Email address').fill('mary@example.com'); await p.locator('#login-password').fill('Mary-Learner-2026'); await p.getByRole('button', { name: 'Sign in' }).click();
  await p.getByTestId('role').filter({ hasText: 'participant' }).waitFor({ timeout: 5000 });
});
await check('an expired or already-used invitation link shows "This link has expired" (no session), nothing changes', sNew.base, null, async (p) => {
  await go(p, '/set-password'); await p.getByRole('heading', { name: 'This link has expired' }).waitFor();
});
await check('a staff invitation (no import record) sets the password exactly as before: no activation call, role unchanged', sNew.base, () => {
  const a = window.__auth; a.users.push({ id: 'u-staff', email: 'trainer@example.com', password: '', role: '' }); a.profiles.set('u-staff', { role: 'trainer', status: 'active' }); window.__inviteLanding('u-staff'); }, async (p) => {
  await go(p, '/set-password'); await p.locator('#sp-password').fill('Trainer-Pass-2026'); await p.getByLabel('Confirm password').fill('Trainer-Pass-2026');
  await p.getByRole('button', { name: 'Save password' }).click(); await p.getByText('Your password is set. Taking you to DIRA Learn').waitFor();
  const st = await p.evaluate(() => ({ calls: window.__auth.invokes, role: window.__auth.profiles.get('u-staff').role }));
  expect(!st.calls.some((c) => c.startsWith('complete-enrolment')) && st.role === 'trainer', JSON.stringify(st));
});
await check('a public applicant signing in is not touched by the enrolment step (no activation call, still an applicant)', sNew.base, () => {
  const a = window.__auth; a.users.push({ id: 'u-pub', email: 'pub@example.com', password: 'Public-2026x', role: '' }); a.profiles.set('u-pub', { role: 'applicant', status: 'active' }); a.confirmed.add('u-pub'); }, async (p) => {
  await go(p, '/login'); await p.getByLabel('Email address').fill('pub@example.com'); await p.locator('#login-password').fill('Public-2026x'); await p.getByRole('button', { name: 'Sign in' }).click();
  await p.getByTestId('role').filter({ hasText: 'applicant' }).waitFor({ timeout: 5000 });
  expect(!(await p.evaluate(() => window.__auth.invokes)).some((c) => c.startsWith('complete-enrolment')), 'activation called');
});
results.push(['no password appears in the browser console', !['Grace-Learner-2026', 'Mary-Learner-2026', 'Trainer-Pass-2026', 'Public-2026x'].some((s) => logs.join('\n').includes(s))]);

await browser.close(); sNew.srv.close(); sOld.srv.close();
const failed = results.filter((r) => !r[1]);
console.log(`direct enrolment (Add learner form and CSV) and the "j.json is not a function" fix in Chrome (simulated Supabase${csp ? ', production Content-Security-Policy' : ''}): ${results.length - failed.length}/${results.length} checks passed`);
for (const f of failed) console.log('  FAILED ' + f[0] + (f[2] ? ' - ' + f[2] : ''));
process.exit(failed.length ? 1 : 0);
