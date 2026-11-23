// DRY-RUN ONLY: a mock of the Supabase Auth recovery endpoints and the Mailpit API, so tools/recovery/recovery_check.mjs can be
// exercised here without Docker. It follows Supabase's documented behaviour (same 200 for unknown addresses, once-a-minute
// requests, expiry from auth.users.recovery_sent_at, single-use codes, newest code wins, 30 checks per 5 minutes per IP,
// password rules). Passwords and recovery times are kept in the scratch database's auth.users, like Supabase does.
import http from 'node:http'; import { appendFileSync } from 'node:fs'; import { execFileSync } from 'node:child_process'; import { randomInt, randomUUID } from 'node:crypto';
const [authPort, mailPort, db, cooldownS] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 60)];
const psql = (q) => execFileSync('psql', ['-h', '/tmp', '-p', '54322', '-U', 'postgres', '-d', db, '-tAX', '-c', q], { encoding: 'utf8' }).trim();
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const codes = new Map(); const tokens = new Map(); const mails = []; let verifies = [];
const strong = (p) => typeof p === 'string' && p.length >= 10 && /[A-Za-z]/.test(p) && /\d/.test(p);
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
const fail = (res, status, code, msg) => send(res, status, { code: status, error_code: code, msg });
const user = (email) => { const r = psql(`select id || '|' || coalesce(extract(epoch from recovery_sent_at)::text, '') from auth.users where email = ${lit(email)}`); if (!r) return null; const [id, sent] = r.split('|'); return { id, sent: sent ? Number(sent) * 1000 : null }; };
const tpl = (code) => `<h1>Reset your password</h1><p>DIRA LEARN</p><span>${code}</span><p>The code works for 15 minutes and can be used only once.</p>`;
http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) body += c; const j = body ? JSON.parse(body) : {};
  const url = new URL(req.url, 'http://x'); const bearer = (req.headers.authorization ?? '').replace(/^Bearer /, '');
  if (!req.headers.apikey) return fail(res, 401, 'no_api_key', 'No API key');
  if (url.pathname === '/auth/v1/recover') {
    const u = user(j.email); if (!u) return send(res, 200, {});
    if (u.sent && Date.now() - u.sent < cooldownS * 1000) return fail(res, 429, 'over_email_send_rate_limit', 'For security purposes, you can only request this after a while.');
    const code = String(randomInt(100000, 999999)); codes.set(j.email, { code, used: false }); if (process.env.CODES_FILE) appendFileSync(process.env.CODES_FILE, code + '\n');
    psql(`update auth.users set recovery_sent_at = now(), recovery_token = 'hashed' where id = ${lit(u.id)}`);
    mails.push({ ID: randomUUID(), To: [{ Address: j.email }], Subject: 'Your DIRA LEARN password reset code', Created: new Date().toISOString(), HTML: tpl(code), Text: '' });
    return send(res, 200, {});
  }
  if (url.pathname === '/auth/v1/verify') {
    const now = Date.now(); verifies = verifies.filter((t) => now - t < 300000); verifies.push(now);
    if (verifies.length > 30) return fail(res, 429, 'over_request_rate_limit', 'Request rate limit reached');
    const u = user(j.email); const c = codes.get(j.email);
    if (j.type !== 'recovery' || !u || !c || c.used || c.code !== j.token || !u.sent || now - u.sent > 900000) return fail(res, 403, 'otp_expired', 'Token has expired or is invalid');
    c.used = true; psql(`update auth.users set recovery_token = '', last_sign_in_at = now() where id = ${lit(u.id)}`);
    const t = randomUUID(); tokens.set(t, u.id); return send(res, 200, { access_token: t, token_type: 'bearer', user: { id: u.id } });
  }
  if (url.pathname === '/auth/v1/user' && req.method === 'PUT') {
    const id = tokens.get(bearer); if (!id) return fail(res, 401, 'no_authorization', 'This endpoint requires a valid Bearer token');
    if (!strong(j.password)) return fail(res, 422, 'weak_password', 'Password is too weak');
    psql(`update auth.users set encrypted_password = crypt(${lit(j.password)}, gen_salt('bf')) where id = ${lit(id)}`);
    return send(res, 200, { id });
  }
  if (url.pathname === '/auth/v1/logout') { const id = tokens.get(bearer); for (const [k, v] of tokens) if (v === id) tokens.delete(k); res.writeHead(204); return res.end(); }
  if (url.pathname === '/auth/v1/token') {
    const ok = psql(`select count(*) from auth.users where email = ${lit(j.email)} and encrypted_password = crypt(${lit(j.password)}, encrypted_password)`) === '1';
    if (!ok) return fail(res, 400, 'invalid_credentials', 'Invalid login credentials');
    const t = randomUUID(); tokens.set(t, 'x'); return send(res, 200, { access_token: t });
  }
  return fail(res, 404, 'not_found', 'not found');
}).listen(authPort, '127.0.0.1');
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/v1/search') { const to = (url.searchParams.get('query') ?? '').replace(/^to:/, ''); return send(res, 200, { messages: mails.filter((m) => m.To[0].Address === to).map(({ HTML, Text, ...m }) => m) }); }
  const m = url.pathname.match(/^\/api\/v1\/message\/(.+)$/); if (m) { const x = mails.find((y) => y.ID === m[1]); return send(res, x ? 200 : 404, x ?? {}); }
  return send(res, 404, {});
}).listen(mailPort, '127.0.0.1');
