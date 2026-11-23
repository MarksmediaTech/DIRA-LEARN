// Chrome tests of Chat and the notification bell (22 Nov 2026), on the REAL application (App.tsx, AppShell, NotificationBell,
// ChatPage...) with the simulated Supabase client in fake-chat-supabase.ts and the app's own Tailwind styles (build-css.mjs).
// Usage: node chat_flow.mjs <project>. The database rules behind these screens are tested separately on PostgreSQL
// (tools/chat/chat_db_check.sh); real Supabase Realtime, Storage and Google need the owner's projects (see the change report).
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { execFileSync } from 'node:child_process';
const proj = path.resolve(process.argv[2]); const here = path.dirname(new URL(import.meta.url).pathname);
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-ui-'));
execFileSync('node', [path.join(here, 'build.mjs'), proj, out], { stdio: 'inherit', env: { ...process.env, HARNESS_ENTRY: 'harness-chat.tsx', HARNESS_FAKE: 'fake-chat-supabase.ts' } });
execFileSync('node', [path.join(here, 'build-css.mjs'), proj, out], { stdio: 'ignore' });
fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>');
const server = http.createServer((q, r) => { const f = q.url === '/app.js' ? 'app.js' : q.url === '/app.css' ? 'app.css' : 'index.html';
  r.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html' }); r.end(fs.readFileSync(path.join(out, f))); });
await new Promise((ok) => server.listen(0, '127.0.0.1', ok)); const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: fs.existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined,
  args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
const results = []; const shots = process.env.CHAT_SHOTS;

async function fresh({ as = 'p-l1', viewport = { width: 1280, height: 800 }, scheme = 'light', path: start = '/chat' } = {}) {
  const ctx = await browser.newContext({ viewport, colorScheme: scheme, permissions: ['microphone'] }); ctx.setDefaultTimeout(6000); const page = await ctx.newPage();
  page.errors = []; page.on('pageerror', (e) => page.errors.push(String(e.message)));
  if (process.env.DEBUG) page.on('console', (m) => { if (m.type() === 'error') console.log('   console:', m.text().slice(0, 300)); });
  page.on('dialog', (d) => void d.accept());
  await page.addInitScript((me) => { window.__chatSeed = { me }; window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; }, as);
  await page.clock.install();
  await page.goto(base + start);
  return { ctx, page };
}
// in-app navigation (a full page load would discard the simulated database)
const go = async (page, url) => { await page.evaluate((u) => { history.pushState(null, '', u); dispatchEvent(new PopStateEvent('popstate')); }, url); await page.waitForTimeout(150); };
const srv = (page, fn, ...args) => page.evaluate(([f, a]) => window.__chatServer[f](...a), [fn, args]);
const st = (page, fn) => page.evaluate(`(${fn})(window.__chat)`);
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
async function test(name, opts, fn) {
  if (process.env.ONLY && !name.includes(process.env.ONLY)) return;
  const { ctx, page } = await fresh(opts);
  try { await Promise.race([fn(page), new Promise((_, no) => setTimeout(() => no(new Error('test took longer than 60 s')), 60_000))]); if (page.errors.length) throw new Error('page error: ' + page.errors[0]); results.push([name, true]); console.log('PASS ', name); }
  catch (e) {
    results.push([name, false, String(e.message ?? e).split('\n')[0] + (process.env.DEBUG ? ' | URL ' + page.url() + ' | ' + (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 500) : '')]);
    console.log('FAIL ', name, '->', results.at(-1)[2]);
    if (shots) await page.screenshot({ path: path.join(shots, name.replace(/\W+/g, '_').slice(0, 60) + '.png') }).catch(() => {});
  }
  await ctx.close();
}
const shot = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };
const bell = (page) => page.locator('header:visible').getByRole('button', { name: /^Notifications/ });
const badge = async (page) => (await bell(page).getAttribute('aria-label')).match(/(\d+) unread/)?.[1] ?? '0';
const waitBadge = async (page, n) => { for (let i = 0; i < 50; i++) { if (await badge(page) === String(n)) return; await page.waitForTimeout(100); } throw new Error(`badge is ${await badge(page)}, expected ${n}`); };
const section = (page, name) => page.getByRole('navigation', { name: 'Chat sections' }).getByRole('button', { name: new RegExp('^' + name) }).click();
const nav = (page) => page.getByRole('navigation', { name: 'Main' });
const pdf = { name: 'Week 1 slides.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%harness\n') };
const mp4 = { name: 'Welcome video.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(2048, 1) };
const docx = { name: 'Notes.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: Buffer.from('PK\u0003\u0004 docx') };
const svg = { name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>') };
const png = { name: 'photo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') };
async function openDmWith(page, person) {
  await section(page, 'Direct messages');
  await page.getByRole('button', { name: 'New conversation' }).click();
  await page.getByRole('list', { name: 'People' }).getByRole('button', { name: new RegExp(person) }).click();
  await page.getByRole('region', { name: new RegExp('Conversation: ' + person) }).waitFor();
}
async function send(page, text) { await page.getByLabel('Message', { exact: true }).fill(text); await page.getByRole('button', { name: 'Send', exact: true }).click(); await page.locator('[id^="msg-"]', { hasText: text }).last().waitFor(); }

// ---------------- bell, header and navigation ----------------
await test('11. the bell is at the extreme top right of the main header, right next to the profile menu (computer)', { path: '/' }, async (p) => {
  const b = bell(p); await b.waitFor();
  const box = await b.boundingBox(); const prof = await p.getByRole('button', { name: /Lucy Learner/ }).boundingBox(); const vw = p.viewportSize().width;
  expect(box.y < 60, `bell is not at the top (y=${box.y})`);
  expect(box.x > vw * 0.75, `bell is not on the right (x=${box.x} of ${vw})`);
  expect(prof && prof.x > box.x && prof.x - (box.x + box.width) < 24, 'the profile menu is not directly to the right of the bell');
  expect(vw - (prof.x + prof.width) < 48, `profile menu is not at the right edge (${vw - (prof.x + prof.width)} px left)`);
  await shot(p, 'desktop-header');
});
await test('12. no Notifications, Announcements or DIRA Connect menu items; one Chat item; /notifications goes to the dashboard, old pages to Chat', { path: '/' }, async (p) => {
  await nav(p).getByRole('link', { name: 'Chat' }).waitFor();
  for (const old of ['Notifications', 'Announcements', 'DIRA Connect']) expect(await nav(p).getByRole('link', { name: old }).count() === 0, `menu still has ${old}`);
  await p.goto(base + '/notifications'); await p.waitForURL((u) => u.pathname === '/');
  await p.goto(base + '/announcements'); await p.waitForURL((u) => u.pathname === '/chat' && u.search === '?section=announcements');
  await p.goto(base + '/connect'); await p.waitForURL((u) => u.pathname === '/chat' && u.search === '?section=direct');
  await nav(p).getByRole('link', { name: 'Chat' }).click(); await p.getByRole('heading', { name: 'Chat', level: 1 }).waitFor();
});
await test('the Chat dashboard has the five sections: Announcements, Direct messages, Group conversations, Shared learning materials, Audio and video', {}, async (p) => {
  await p.getByRole('navigation', { name: 'Chat sections' }).getByRole('button').first().waitFor();
  const names = await p.getByRole('navigation', { name: 'Chat sections' }).getByRole('button').allInnerTexts();
  for (const s of ['Announcements', 'Direct messages', 'Group conversations', 'Shared learning materials', 'Audio & video messages']) expect(names.some((n) => n.includes(s)), `section missing: ${s} (have ${names.join(' | ')})`);
});
await test('13. a new notification pops up once (even if delivered twice), rings the bell, raises the badge and disappears by itself after 6 seconds', { path: '/' }, async (p) => {
  await bell(p).waitFor(); await waitBadge(p, 0);
  await srv(p, 'notify', 'p-l1', 'course', 'New course published', 'Digital Skills 101 is open', '/courses');
  const toast = p.locator('[aria-live="polite"] [role="status"]', { hasText: 'New course published' });
  await toast.waitFor(); await waitBadge(p, 1);
  expect(await p.locator('[data-icon="Bell"].animate-ring').count() > 0, 'the bell did not ring');
  const id = await st(p, (s) => s.notifs[0].id); await srv(p, 'redeliver', id); await p.waitForTimeout(300);
  expect(await toast.count() === 1, 'the same notification popped up twice');
  await p.clock.runFor(6500);
  await toast.waitFor({ state: 'detached', timeout: 3000 });
  expect(await badge(p) === '1', 'the notification must stay unread in the history after the pop-up goes');
  await srv(p, 'notify', 'p-l1', 'course', 'Second', 'x', '/courses'); await p.locator('[role="status"]', { hasText: 'Second' }).waitFor();
  await p.getByRole('button', { name: 'Dismiss' }).click(); await p.locator('[role="status"]', { hasText: 'Second' }).waitFor({ state: 'detached' });
});
await test('14-16. the dropdown lists title, text and time; mark one read, mark all read; older notifications load on request', { path: '/' }, async (p) => {
  await srv(p, 'bulkNotify', 'p-l1', 24); await srv(p, 'notify', 'p-l1', 'announcement', 'Exam timetable', 'See the new dates', '/chat?section=announcements');
  await waitBadge(p, 25);
  await bell(p).click(); const dlg = p.getByRole('dialog', { name: 'Notifications' }); await dlg.waitFor();
  const items = dlg.getByRole('list', { name: 'Notification history' }).getByRole('listitem');
  await items.first().waitFor(); expect(await items.count() === 20, `first page should have 20, has ${await items.count()}`);
  const first = await items.first().innerText(); expect(/Exam timetable/.test(first) && /See the new dates/.test(first) && /(just now|min|ago)/i.test(first), 'title/text/time missing: ' + first);
  await dlg.getByRole('button', { name: 'Show older notifications' }).click();
  for (let i = 0; i < 30 && (await items.count()) < 25; i++) await p.waitForTimeout(100);
  expect(await items.count() === 25, `after Show older: ${await items.count()}`);
  await dlg.getByRole('button', { name: 'Mark "Exam timetable" as read' }).click(); await waitBadge(p, 24);
  await dlg.getByRole('button', { name: 'Mark all as read' }).click(); await waitBadge(p, 0);
  expect(await st(p, (s) => s.notifs.filter((n) => !n.read_at).length) === 0, 'not all marked read in the database');
  await shot(p, 'desktop-dropdown');
  await p.keyboard.press('Escape'); await dlg.waitFor({ state: 'detached' });
});
await test('17. opening a notification goes to the right announcement and the right message', { path: '/' }, async (p) => {
  const annId = await srv(p, 'publishAs', 'p-admin', 'Graduation day');
  await bell(p).click(); await p.getByRole('dialog', { name: 'Notifications' }).getByRole('button', { name: /^New announcement: Graduation day/ }).click();
  await p.waitForURL((u) => u.pathname === '/chat' && u.searchParams.get('a') === annId);
  const art = p.locator(`#ann-${annId}`); await art.waitFor(); expect((await art.getAttribute('class')).includes('ring-orange'), 'announcement not highlighted');
  const conv = await page_dm(p, 'p-l2'); const mid = await srv(p, 'sendAs', conv, 'p-l2', 'Are you coming to class?');
  await bell(p).click(); await p.getByRole('dialog', { name: 'Notifications' }).getByRole('button', { name: /^New message from Liam Learner/ }).click();
  await p.waitForURL((u) => u.searchParams.get('c') === conv && u.searchParams.get('m') === mid);
  await p.locator(`#msg-${mid}`).waitFor(); await p.getByRole('region', { name: 'Conversation: Liam Learner' }).waitFor();
});
async function page_dm(p, other) { return p.evaluate((o) => { const s = window.__chat; const id = 'dm-' + o; s.convs.push({ id, kind: 'dm', title: null, locked: false }); s.members.push({ conv: id, profile: s.me, is_owner: false, last_read_at: null }, { conv: id, profile: o, is_owner: false, last_read_at: null }); return id; }, other); }
await test('phones: the bell sits in the top bar beside Menu and its dropdown stays inside the screen', { path: '/', viewport: { width: 375, height: 740 } }, async (p) => {
  await srv(p, 'notify', 'p-l1', 'course', 'A very long notification title that must wrap nicely on a small phone screen', 'And a body text', '/courses');
  const b = bell(p); await b.waitFor(); const box = await b.boundingBox(); const menu = await p.getByRole('button', { name: 'Menu' }).boundingBox();
  expect(box.y < 60 && box.x > 375 * 0.55 && menu.x > box.x, `bell position on phone: ${JSON.stringify(box)}`);
  await p.clock.runFor(7000);
  await b.click(); const dlg = p.getByRole('dialog', { name: 'Notifications' }); await dlg.waitFor();
  const d = await dlg.boundingBox(); expect(d.x >= 0 && d.x + d.width <= 375 && d.y + d.height <= 740, `dropdown outside the screen: ${JSON.stringify(d)}`);
  const sw = await p.evaluate(() => document.documentElement.scrollWidth); expect(sw <= 375, `page scrolls sideways (${sw}px)`);
  await shot(p, 'phone-dropdown');
});
await test('the dark theme is applied to the bell dropdown and the Chat screen when the device uses dark mode', { scheme: 'dark' }, async (p) => {
  await p.getByRole('heading', { name: 'Chat', level: 1 }).waitFor();
  await bell(p).click(); const dlg = p.getByRole('dialog', { name: 'Notifications' }); await dlg.waitFor();
  const bg = await dlg.evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(/rgb\(17, 24, 39\)|oklch\(0\.21/.test(bg), 'dropdown is not dark: ' + bg);
  await shot(p, 'dark-chat');
});

await test('18. no previews of other people\'s private messages: an outsider gets no notification or pop-up and cannot open the conversation', { as: 'p-l3', path: '/' }, async (p) => {
  await bell(p).waitFor();
  const conv = await p.evaluate(() => { const s = window.__chat; s.convs.push({ id: 'dm-private', kind: 'dm', title: null, locked: false }); s.members.push({ conv: 'dm-private', profile: 'p-l1', is_owner: false, last_read_at: null }, { conv: 'dm-private', profile: 'p-l2', is_owner: false, last_read_at: null }); return 'dm-private'; });
  await srv(p, 'sendAs', conv, 'p-l1', 'My exam password is secret123'); await p.waitForTimeout(500);
  expect(await badge(p) === '0', 'the outsider got a notification');
  expect(!(await p.locator('body').innerText()).includes('secret123'), 'the private text appeared on the outsider\'s screen');
  await bell(p).click(); await p.getByText(/all caught up/).waitFor();
  await go(p, '/chat?c=dm-private'); await p.getByText('This conversation is not available to you.').waitFor();
  expect(!(await p.locator('body').innerText()).includes('secret123'), 'private text shown');
});

// ---------------- announcements ----------------
await test('1. staff publish an announcement to a cohort with a PDF and a video, pinned, with a confirmation; the cohort is notified', { as: 'p-admin', path: '/chat?section=announcements' }, async (p) => {
  await p.getByRole('button', { name: /Share an announcement/ }).click();
  await p.getByLabel('Who should see it').selectOption('cohort'); await p.getByRole('combobox', { name: /^Cohort/ }).selectOption({ label: 'Cohort 1 - Nairobi' });
  await p.getByLabel('Title').fill('Week 1 materials'); await p.getByLabel('Message', { exact: true }).fill('Slides and the welcome video for week 1.');
  await p.locator('input[type=file][aria-label="Attach learning materials"]').setInputFiles([pdf, mp4]);
  await p.getByRole('list', { name: 'Files to send' }).getByText('Welcome video.mp4').waitFor();
  await p.getByLabel('Pin to the top').check();
  await p.getByRole('button', { name: /Publish/ }).click();
  await p.getByText(/Published\. Everyone addressed has been notified\./).waitFor();
  const card = p.locator('article', { hasText: 'Week 1 materials' }); await card.waitFor();
  expect(/Pinned/.test(await card.innerText()) && /Cohort 1 - Nairobi/.test(await card.innerText()), 'card lacks Pinned or audience');
  await card.getByRole('button', { name: /Week 1 slides\.pdf/ }).waitFor(); await card.locator('video').waitFor();
  const told = await st(p, (s) => s.notifs.filter((n) => n.kind === 'announcement').map((n) => n.user_id).sort());
  expect(told.includes('p-l1') && told.includes('p-l2') && !told.includes('p-l3') && !told.includes('p-admin'), 'wrong people notified: ' + told);
  await shot(p, 'staff-announcement');
});
await test('staff can edit, unpin and delete their own announcement', { as: 'p-trainer', path: '/chat?section=announcements' }, async (p) => {
  await p.getByRole('button', { name: /Share an announcement/ }).click();
  await p.getByLabel('Title').fill('Room change'); await p.getByLabel('Message', { exact: true }).fill('We meet in room 4.'); await p.getByLabel('Pin to the top').check();
  await p.getByRole('button', { name: /Publish/ }).click(); await p.locator('article', { hasText: 'Room change' }).waitFor();
  const card = p.locator('#' + await p.locator('article', { hasText: 'Room change' }).getAttribute('id'));
  await card.getByRole('button', { name: 'Edit' }).click(); await card.getByLabel('Title').fill('Room change (updated)'); await card.getByRole('button', { name: 'Save' }).click();
  await card.getByText(/edited/).waitFor(); await card.getByText('Room change (updated)').waitFor();
  expect(await st(p, (s) => s.notifs.some((n) => n.user_id === 'p-l1' && n.kind === 'announcement')), 'learners were not notified');
  await card.getByRole('button', { name: 'Unpin' }).click(); await card.getByRole('button', { name: 'Pin to the top' }).waitFor();
  await card.getByRole('button', { name: 'Delete' }).click(); await card.waitFor({ state: 'detached' });
});
await test('2-3. learners read, download and react with emoji, but cannot publish, edit, delete or reply to announcements', {}, async (p) => {
  const id = await p.evaluate(() => { const s = window.__chat; const id = 'ann-x'; s.anns.push({ id, title: 'Exam dates', body: 'Exams start on 1 December.', audience: 'everyone', cohort_id: null, track_id: null, pinned: false, created_by: 'p-admin', created_at: new Date().toISOString(), edited_at: null });
    s.annAtts.push({ id: 'f1', announcement_id: id, storage_path: id + '/f1-timetable.pdf', file_name: 'Timetable.pdf', mime_type: 'application/pdf', size_bytes: 20, created_at: new Date().toISOString() });
    s.files.push({ bucket: 'announcement-files', path: id + '/f1-timetable.pdf', blob: new Blob(['%PDF'], { type: 'application/pdf' }), type: 'application/pdf' }); return id; });
  await section(p, 'Direct messages'); await section(p, 'Announcements');
  const card = p.locator(`#ann-${id}`); await card.waitFor();
  expect(await p.getByRole('button', { name: /Share an announcement/ }).count() === 0, 'learner sees the publish box');
  for (const b of ['Edit', 'Delete', 'Pin to the top', 'Reply']) expect(await card.getByRole('button', { name: b, exact: true }).count() === 0, `learner sees ${b}`);
  expect(await card.locator('textarea').count() === 0, 'learner sees a reply box');
  await card.getByRole('button', { name: /Timetable\.pdf/ }).click();
  for (let i = 0; i < 20 && !(await p.evaluate(() => window.__opened.length)); i++) await p.waitForTimeout(100);
  expect((await p.evaluate(() => window.__opened[0])).startsWith('blob:'), 'download did not open a short-lived link');
  await card.getByRole('button', { name: 'React to this announcement' }).click();
  await card.getByRole('dialog', { name: 'Choose an emoji' }).getByRole('button', { name: 'Celebrate' }).click().catch(async () => { await card.getByRole('dialog', { name: 'Choose an emoji' }).getByRole('button').nth(6).click(); });
  await card.getByRole('button', { pressed: true }).waitFor();
  expect(await st(p, (s) => s.annReactions.length) === 1, 'reaction not saved');
});
await test('learners of another cohort do not see a cohort announcement', { as: 'p-l3', path: '/chat?section=announcements' }, async (p) => {
  await srv(p, 'publishAs', 'p-admin', 'Only for cohort 1', 'cohort', 'c-1'); await srv(p, 'publishAs', 'p-admin', 'For everyone');
  await section(p, 'Direct messages'); await section(p, 'Announcements');
  await p.getByText('For everyone', { exact: true }).waitFor(); expect(await p.getByText('Only for cohort 1').count() === 0, 'cohort 2 learner sees the cohort 1 announcement');
});

// ---------------- direct messages and groups ----------------
await test('4. learner to learner: only learners of the same cohort can be found; message, reply and react; the other learner is notified', {}, async (p) => {
  await section(p, 'Direct messages'); await p.getByRole('button', { name: 'New conversation' }).click();
  const people = p.getByRole('list', { name: 'People' }); await people.getByRole('button').first().waitFor();
  const names = await people.innerText(); expect(names.includes('Liam Learner') && !names.includes('Olive Outsider') && !names.includes('Mo Evaluator'), 'wrong contacts: ' + names.replace(/\s+/g, ' '));
  await people.getByRole('button', { name: /Liam Learner/ }).click(); await p.getByRole('region', { name: /Conversation: Liam Learner/ }).waitFor();
  await send(p, 'Hi Liam, shall we revise together?');
  expect(await st(p, (s) => s.notifs.some((n) => n.user_id === 'p-l2' && n.kind === 'message')), 'Liam was not notified');
  await srv(p, 'switchUser', 'p-l2'); await go(p, '/chat?section=direct');
  await waitBadge(p, 1);
  const row = p.getByRole('list', { name: 'Conversations' }).getByRole('button', { name: /Lucy Learner/ }); await row.waitFor();
  expect(/1\s*unread/.test(await row.innerText()), 'unread count not shown');
  await row.click(); const first = p.locator('[id^="msg-"]', { hasText: 'Hi Liam, shall we revise together?' }); await first.waitFor(); const msg = p.locator('#' + await first.getAttribute('id'));
  await waitBadge(p, 0);
  await msg.hover(); await p.getByRole('button', { name: 'Reply', exact: true }).click(); await p.getByText('Replying to Lucy Learner').waitFor();
  await send(p, 'Yes! 4pm?');
  await p.locator('a[href^="#msg-"]', { hasText: 'Lucy Learner' }).waitFor();
  await msg.hover(); await p.getByRole('button', { name: 'React 👍' }).first().click();
  await p.getByRole('button', { name: /: 1, including you/ }).waitFor();
  await shot(p, 'dm-thread');
});
await test('5-6. learner to trainer: a learner can message their cohort trainer; the trainer sees it with read ticks for the sender', {}, async (p) => {
  await openDmWith(p, 'Tom Trainer'); await send(p, 'Sir, I missed the session.');
  const sent = p.locator('[id^="msg-"]', { hasText: 'Sir, I missed the session.' });
  expect(await sent.getByText('Sent').count() === 1, 'no Sent tick');
  await srv(p, 'switchUser', 'p-trainer'); await go(p, '/chat?section=direct');
  await p.getByRole('list', { name: 'Conversations' }).getByRole('button', { name: /Lucy Learner/ }).click();
  await p.locator('[id^="msg-"]', { hasText: 'Sir, I missed the session.' }).waitFor(); await send(p, 'No problem, the slides are in Announcements.');
  await srv(p, 'switchUser', 'p-l1'); await go(p, '/chat?section=direct');
  await p.getByRole('list', { name: 'Conversations' }).getByRole('button', { name: /Tom Trainer/ }).click();
  await p.locator('[id^="msg-"]', { hasText: 'Sir, I missed the session.' }).getByText('Seen').waitFor();
});
await test('online and offline status is shown for the person in a conversation', {}, async (p) => {
  await openDmWith(p, 'Liam Learner'); const head = p.getByRole('region', { name: /Conversation: Liam Learner/ }).locator('header');
  await head.locator('p', { hasText: /· Offline/ }).waitFor();
  await srv(p, 'setOnline', ['p-l1', 'p-l2']); await head.locator('p', { hasText: /· Online/ }).waitFor();
});
await test('7. groups: learners cannot create groups; a trainer creates one with learners, who are notified and can talk in it', {}, async (p) => {
  await section(p, 'Group conversations');
  await p.getByText('Cohort 1 - Nairobi discussion').waitFor();
  expect(await p.getByRole('button', { name: 'New group' }).count() === 0, 'learner can create a group');
  await srv(p, 'switchUser', 'p-trainer'); await go(p, '/chat?section=groups');
  await p.getByRole('button', { name: 'New group' }).click(); await p.getByLabel('Group name').fill('Project team A');
  const people = p.getByRole('list', { name: 'People' }); await people.getByRole('button', { name: /Lucy Learner/ }).click(); await people.getByRole('button', { name: /Liam Learner/ }).click();
  await p.getByRole('button', { name: 'Create group (3)' }).click();
  await p.getByRole('region', { name: 'Conversation: Project team A' }).waitFor(); await p.getByText('3 members').waitFor();
  await send(p, 'Welcome to project team A');
  expect(await st(p, (s) => ['p-l1', 'p-l2'].every((u) => s.notifs.some((n) => n.user_id === u && n.kind === 'group'))), 'members not told they were added');
  await srv(p, 'switchUser', 'p-l1'); await go(p, '/chat?section=groups');
  await p.getByRole('list', { name: 'Conversations' }).getByRole('button', { name: /Project team A/ }).click();
  await p.locator('[id^="msg-"]', { hasText: 'Welcome to project team A' }).waitFor(); await send(p, 'Thanks!');
  expect(await p.getByRole('button', { name: 'Add members' }).count() === 0, 'a member who is not the owner can add members');
});
await test('9. files in conversations: video and Word upload; SVG and too-large files are refused with a clear message', {}, async (p) => {
  await openDmWith(p, 'Liam Learner');
  const input = p.locator('input[type=file][aria-label="Attach files"]');
  await input.setInputFiles([svg]); await p.getByRole('alert').filter({ hasText: /logo\.svg/ }).waitFor();
  expect(await p.getByRole('list', { name: 'Files to send' }).count() === 0, 'SVG was accepted');
  const huge = path.join(out, 'huge.mp4'); fs.writeFileSync(huge, Buffer.alloc(51 * 1024 * 1024)); await input.setInputFiles(huge);
  await p.getByRole('alert').filter({ hasText: /huge\.mp4/ }).waitFor();
  await input.setInputFiles([mp4, docx]); await p.getByRole('list', { name: 'Files to send' }).getByText('Notes.docx').waitFor();
  await p.getByRole('button', { name: 'Send', exact: true }).click(); await p.locator('[id^="msg-"]', { hasText: 'Shared 2 files' }).waitFor();
  const atts = await st(p, (s) => s.atts.map((a) => a.mime_type + ' ' + a.scan_status));
  expect(atts.length === 2 && atts.every((x) => x.endsWith('pending')), 'attachments: ' + atts);
});
await test('10. files open only after a clean virus check (scan gate), images then show inside the chat', {}, async (p) => {
  await openDmWith(p, 'Liam Learner');
  await p.locator('input[type=file][aria-label="Attach files"]').setInputFiles([png]); await p.getByRole('button', { name: 'Send', exact: true }).click();
  const bubble = p.locator('[id^="msg-"]', { hasText: 'Shared photo.png' }); await bubble.waitFor();
  await bubble.getByText(/photo\.png .*·/).waitFor();
  expect(await bubble.locator('img').count() === 0 && await bubble.getByRole('button', { name: /photo\.png/ }).count() === 0, 'a file waiting for its check can be opened');
  expect(await st(p, (s) => s.signedUrls) === 0, 'a link was issued before the check');
  await srv(p, 'setScan', 'photo.png', 'clean'); await srv(p, 'sendAs', await st(p, (s) => s.convs.find((c) => c.kind === 'dm').id), 'p-l2', 'nice');
  await bubble.locator('img[alt="photo.png"]').waitFor(); await bubble.getByRole('button', { name: /photo\.png/ }).waitFor();
});
await test('8. voice messages: record with the microphone, preview, play, delete, record again and send', {}, async (p) => {
  await openDmWith(p, 'Liam Learner');
  await p.getByRole('button', { name: 'Record a voice message' }).click(); await p.getByText(/Recording 0:0/).waitFor();
  await p.clock.runFor(2500); await p.waitForTimeout(600);
  await p.getByRole('button', { name: 'Stop recording' }).click(); await p.getByRole('button', { name: 'Use recording' }).waitFor();
  await p.getByRole('button', { name: 'Play the recording' }).click(); await p.getByRole('button', { name: 'Pause' }).waitFor();
  await p.getByRole('button', { name: 'Delete the recording' }).click(); await p.getByRole('button', { name: 'Record a voice message' }).waitFor();
  await p.getByRole('button', { name: 'Record a voice message' }).click(); await p.waitForTimeout(800);
  await p.getByRole('button', { name: 'Stop recording' }).click(); await p.getByRole('button', { name: 'Use recording' }).click();
  await p.getByRole('list', { name: 'Files to send' }).getByText(/voice-message-.*\.webm/).waitFor();
  await p.getByRole('button', { name: 'Send', exact: true }).click(); await p.locator('[id^="msg-"]', { hasText: 'Voice message' }).waitFor();
  const a = await st(p, (s) => s.atts.map((x) => [x.mime_type, x.size_bytes]));
  expect(a.length === 1 && a[0][0] === 'audio/webm' && a[0][1] > 100, 'recording not uploaded as audio/webm: ' + JSON.stringify(a));
  await srv(p, 'setScan', a.length && (await st(p, (s) => s.atts[0].file_name)), 'clean'); await srv(p, 'sendAs', await st(p, (s) => s.convs.find((c) => c.kind === 'dm').id), 'p-l2', 'got it');
  await p.locator('[id^="msg-"]', { hasText: 'Voice message' }).locator('audio[controls]').waitFor();
  await shot(p, 'voice-message');
});
await test('message search inside a conversation and across conversations', {}, async (p) => {
  await openDmWith(p, 'Liam Learner'); await send(p, 'The assignment is due Friday'); await send(p, 'See you tomorrow');
  await p.getByRole('button', { name: 'Search this conversation' }).click(); await p.getByLabel('Search messages in this conversation').fill('friday');
  await p.getByText('1 message found').waitFor(); expect(await p.locator('[id^="msg-"]', { hasText: 'See you tomorrow' }).count() === 0, 'non-matching message still shown');
  await p.getByRole('button', { name: 'Back to conversations' }).click({ trial: false }).catch(() => {});
  await p.getByPlaceholder('Search conversations and messages').fill('assignment');
  await p.getByText('Messages', { exact: true }).waitFor();
});
await test('shared learning materials and audio/video sections list files from announcements and conversations', {}, async (p) => {
  await p.evaluate(() => { const s = window.__chat; s.anns.push({ id: 'a2', title: 'Recorded lesson', body: '', audience: 'everyone', cohort_id: null, track_id: null, pinned: false, created_by: 'p-admin', created_at: new Date().toISOString(), edited_at: null });
    for (const [n, m] of [['Lesson 3.mp3', 'audio/mpeg'], ['Handbook.pdf', 'application/pdf']]) { s.annAtts.push({ id: n, announcement_id: 'a2', storage_path: 'a2/' + n, file_name: n, mime_type: m, size_bytes: 1000, created_at: new Date().toISOString() }); s.files.push({ bucket: 'announcement-files', path: 'a2/' + n, blob: new Blob(['x'], { type: m }), type: m }); } });
  await section(p, 'Shared'); await p.getByRole('button', { name: /Handbook\.pdf/ }).waitFor(); expect(await p.getByText('Lesson 3.mp3').count() === 0, 'audio listed under materials');
  await section(p, 'Audio'); await p.getByRole('button', { name: /Lesson 3\.mp3/ }).waitFor(); await p.locator('audio[controls]').waitFor();
});

// ---------------- Google Calendar sync status (Calendar page) ----------------
const seedGcal = (p, mode, rows) => p.evaluate(([m, r]) => { window.__chat.gcalMode = m; window.__chat.gcal.push(...r); }, [mode, rows]);
await test('20. calendar: without Google set up the calendar works and the panel says "Not set up"; learners never see the panel', { as: 'p-trainer', path: '/' }, async (p) => {
  await seedGcal(p, 'unset', [{ schedule_id: 's1', state: 'pending', last_error: null, synced_at: null, attempts: 0 }]);
  await go(p, '/calendar'); await p.getByRole('heading', { name: 'Calendar', level: 1 }).waitFor();
  const panel = p.getByRole('region', { name: 'Google Calendar sync' }); await panel.getByText('Not set up').waitFor();
  await p.getByRole('button', { name: 'Week' }).click(); await p.getByRole('button', { name: 'Week', pressed: true }).waitFor();
  await srv(p, 'switchUser', 'p-l1'); await go(p, '/'); await go(p, '/calendar'); await p.getByRole('heading', { name: 'Calendar', level: 1 }).waitFor();
  await p.waitForTimeout(300); expect(await p.getByRole('region', { name: 'Google Calendar sync' }).count() === 0, 'a learner sees the sync panel');
});
await test('19-20. calendar: sync status, Google failure shown without breaking the calendar, retry of failed changes, then up to date', { as: 'p-trainer', path: '/' }, async (p) => {
  await seedGcal(p, 'google-down', [{ schedule_id: 's1', state: 'pending', last_error: null, synced_at: null, attempts: 7 }, { schedule_id: 's2', state: 'synced', last_error: null, synced_at: new Date().toISOString(), attempts: 1 }]);
  await go(p, '/calendar'); const panel = p.getByRole('region', { name: 'Google Calendar sync' }); await panel.getByText('1 waiting', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Sync now' }).click(); await panel.getByRole('alert').filter({ hasText: 'invalid_grant' }).waitFor();
  await panel.getByText('1 failed', { exact: true }).waitFor(); await panel.getByRole('list', { name: 'Last sync errors' }).waitFor();
  await p.getByRole('button', { name: 'Month' }).click(); await p.getByRole('button', { name: 'Today' }).waitFor();   // the calendar itself still works
  await p.evaluate(() => { window.__chat.gcalMode = 'ok'; });
  await panel.getByRole('button', { name: 'Retry failed' }).click(); await panel.getByText('1 failed change(s) will be sent again.').waitFor(); await panel.getByText('1 waiting', { exact: true }).waitFor();
  await panel.getByRole('button', { name: 'Sync now' }).click(); await panel.getByText(/Sent 1 change\(s\): 1 done, 0 failed/).waitFor(); await panel.getByText('Up to date', { exact: true }).waitFor();
  await shot(p, 'calendar-sync');
});

const passed = results.filter((r) => r[1]).length; console.log(`\n${passed}/${results.length} Chat and notification screen tests passed (Chrome, simulated Supabase)`);
await browser.close(); server.close(); process.exit(passed === results.length ? 0 : 1);
