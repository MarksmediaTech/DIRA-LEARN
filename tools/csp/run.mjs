// Content-Security-Policy test in Chrome (post-audit priority 5). The policy is the one scripts/write-headers.mjs writes
// at build time. A page served with it probes everything the app needs - Supabase Data API, Auth (incl. password recovery),
// Edge Functions, Storage files, Realtime WebSocket, DIRA photos - against a SIMULATED Supabase origin, and things it must block:
// another origin, inline script, eval, framing. Usage: node run.mjs <project>
import { chromium } from '/opt/npm-tools/node_modules/playwright/index.mjs';
import http from 'node:http'; import crypto from 'node:crypto'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { execFileSync } from 'node:child_process';
const proj = path.resolve(process.argv[2]);
const { buildCsp, photoOriginFor } = await import(path.join(proj, 'scripts', 'write-headers.mjs'));
const listen = (srv) => new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv.address().port)));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
function backend() {   // answers like Supabase would (CORS open, so only the CSP decides)
  const s = http.createServer((q, r) => {
    const h = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (q.method === 'OPTIONS') { r.writeHead(204, h); return r.end(); }
    if (q.url.includes('/storage/') || q.url.endsWith('.png')) { r.writeHead(200, { ...h, 'content-type': 'image/png' }); return r.end(PNG); }
    r.writeHead(200, { ...h, 'content-type': 'application/json' }); r.end('{"ok":true}');
  });
  s.on('upgrade', (q, sock) => {   // minimal WebSocket handshake (Realtime)
    const accept = crypto.createHash('sha1').update(q.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  });
  return s;
}
const S = `http://127.0.0.1:${await listen(backend())}`;   // "Supabase"
const O = `http://localhost:${await listen(backend())}`;    // some other website
const csp = buildCsp({ supabaseUrl: S, photoOrigin: null, allowInsecureForTests: true });

const probe = `
const S = ${JSON.stringify(S)}, O = ${JSON.stringify(O)}; const r = window.__r = { violations: [] };
document.addEventListener('securitypolicyviolation', (e) => r.violations.push(e.violatedDirective + ' ' + e.blockedURI));
const f = (u, o) => fetch(u, o).then((x) => x.ok, () => false);
const img = (u) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(true); i.onerror = () => ok(false); i.src = u; });
const ws = (u) => new Promise((ok) => { try { const w = new WebSocket(u); w.onopen = () => { ok(true); w.close(); }; w.onerror = () => ok(false); } catch { ok(false); } });
r.rest = await f(S + '/rest/v1/profiles?select=id', { headers: { apikey: 'k', Authorization: 'Bearer t' } });
r.authSignIn = await f(S + '/auth/v1/token?grant_type=password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
r.recoveryEmail = await f(S + '/auth/v1/recover', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":"a@b.c"}' });
r.recoveryVerify = await f(S + '/auth/v1/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"type":"recovery"}' });
r.recoveryUpdate = await f(S + '/auth/v1/user', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"password":"x"}' });
r.edgeFunction = await f(S + '/functions/v1/invite-user', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer t' }, body: '{}' });
r.storageUpload = await f(S + '/storage/v1/object/submissions/u/a.pdf', { method: 'POST', body: 'x' });
r.storageImage = await img(S + '/storage/v1/object/sign/submissions/u/a.png?token=t');
r.realtime = await ws(S.replace('http', 'ws') + '/realtime/v1/websocket?apikey=k&vsn=1.0.0');
r.ownPhoto = await img('/photos/test-640.png');
r.otherFetch = await f(O + '/steal', { method: 'POST', body: 'x' });
r.otherImage = await img(O + '/x.png');
r.otherSocket = await ws(O.replace('http', 'ws') + '/x');
try { eval('1'); r.eval = true; } catch { r.eval = false; }
r.inline = window.__inlineRan === true;
r.done = true;`;
const app = http.createServer((q, r) => {
  const head = { 'content-security-policy': csp, 'x-frame-options': 'DENY' };
  if (q.url === '/probe.js') { r.writeHead(200, { ...head, 'content-type': 'text/javascript' }); return r.end(probe); }
  if (q.url.startsWith('/photos/')) { r.writeHead(200, { ...head, 'content-type': 'image/png' }); return r.end(PNG); }
  r.writeHead(200, { ...head, 'content-type': 'text/html' });
  r.end('<!doctype html><title>DIRA LEARN</title><script>window.__inlineRan = true</script><script type="module" src="/probe.js"></script>');
});
const APP = `http://127.0.0.1:${await listen(app)}`;
const framer = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html' }); r.end(`<!doctype html><iframe id="f" src="${APP}/"></iframe>`); });
const FRAMER = `http://localhost:${await listen(framer)}`;

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage(); await page.goto(APP + '/'); await page.waitForFunction(() => window.__r?.done === true, null, { timeout: 15000 });
const r = await page.evaluate(() => window.__r);
const results = []; const ok = (c, m) => results.push([Boolean(c), m]);
ok(r.rest, 'Supabase Data API (REST and database functions) allowed');
ok(r.authSignIn, 'Supabase Auth sign-in allowed');
ok(r.recoveryEmail && r.recoveryVerify && r.recoveryUpdate, 'password recovery calls (send code, verify code, set new password) allowed');
ok(r.edgeFunction, 'Edge Functions allowed');
ok(r.storageUpload && r.storageImage, 'Supabase Storage upload and signed file/image allowed');
ok(r.realtime, 'Realtime WebSocket to the Supabase project allowed');
ok(r.ownPhoto, 'DIRA photos stored with the site (/photos) allowed');
ok(!r.otherFetch, 'requests to any other website are blocked (no data can be sent elsewhere)');
ok(!r.otherImage, 'images from other websites are blocked');
ok(!r.otherSocket, 'WebSockets to other websites are blocked');
ok(!r.eval, 'eval() is blocked');
ok(!r.inline, 'inline scripts are blocked (a script injected into the page would not run)');
ok(r.violations.every((v) => /^(connect-src|img-src|script-src|script-src-elem) /.test(v)) && r.violations.length >= 4, `only the intended blocks were reported (${r.violations.length} violations)`);
const fp = await browser.newPage(); const msgs = []; fp.on('console', (m) => msgs.push(m.text()));
await fp.goto(FRAMER + '/'); await fp.waitForTimeout(800);
const framed = await fp.evaluate(() => { try { return document.getElementById('f').contentWindow.location.href; } catch { return 'cross-origin'; } });
ok(msgs.some((m) => /frame-ancestors|X-Frame-Options|Refused to (display|frame)/i.test(m)) || framed === 'chrome-error://chromewebdata/', 'another website cannot show DIRA LEARN in a frame (clickjacking)');
await browser.close();

// The build step itself
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'csp-')); fs.mkdirSync(path.join(tmp, 'scripts')); fs.mkdirSync(path.join(tmp, 'dist'));
fs.copyFileSync(path.join(proj, 'scripts', 'write-headers.mjs'), path.join(tmp, 'scripts', 'write-headers.mjs'));
const run = (env) => { fs.copyFileSync(path.join(proj, 'public', '_headers'), path.join(tmp, 'dist', '_headers'));
  try { execFileSync('node', [path.join(tmp, 'scripts', 'write-headers.mjs')], { env: { PATH: process.env.PATH, ...env }, stdio: 'pipe' }); return fs.readFileSync(path.join(tmp, 'dist', '_headers'), 'utf8'); } catch { return null; } };
const good = run({ VITE_SUPABASE_URL: 'https://abcd.supabase.co' });
ok(good && good.includes("connect-src 'self' https://abcd.supabase.co wss://abcd.supabase.co") && !good.includes('__CONTENT') && good.includes("frame-ancestors 'none'"), 'the build writes the policy for the project it was built for');
ok(good && good.includes('img-src') && good.includes('https://dirafoundationken.netlify.app'), 'while no photos are stored in /photos, the website photo host is allowed (images only)');
fs.mkdirSync(path.join(tmp, 'dist', 'photos')); fs.writeFileSync(path.join(tmp, 'dist', 'photos', 'a-640.webp'), 'x');
const local = run({ VITE_SUPABASE_URL: 'https://abcd.supabase.co' });
ok(local && !local.includes('netlify'), 'once the photos are stored with the site, no outside image host is allowed');
ok(run({}) === null, 'the build stops when VITE_SUPABASE_URL is missing');
ok(run({ VITE_SUPABASE_URL: 'http://abcd.supabase.co' }) === null, 'the build stops for a non-https Supabase address');
ok(!/unsafe-inline|unsafe-eval|\*/.test(good.split('Content-Security-Policy:')[1].split('\n')[0]), "the policy has no 'unsafe-inline', no 'unsafe-eval' and no wildcard");
fs.rmSync(tmp, { recursive: true });
for (const [g, m] of results) console.log(`${g ? 'PASS' : 'FAIL'}  ${m}`);
console.log(`Content-Security-Policy in Chrome: ${results.filter((x) => x[0]).length}/${results.length} checks passed`);
process.exit(results.every((x) => x[0]) ? 0 : 1);
