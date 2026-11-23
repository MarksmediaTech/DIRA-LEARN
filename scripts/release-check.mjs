#!/usr/bin/env node
// DIRA LEARN release check - run on any computer with internet and Node 22 (Windows, macOS, Linux) or in GitHub Actions:
//     node scripts/release-check.mjs
// It runs, in this order, and stops at the first step that cannot continue:
//   1. Node version (must match .nvmrc), and the Cloudflare Workers configuration (wrangler.jsonc: static assets from dist/,
//      SPA routing, no Worker script, no secrets)
//   2. package-lock.json: if missing, `npm install` creates it from package.json (commit the file afterwards)
//   3. npm ci              - clean install exactly from the lock file
//   4. npm run typecheck   - TypeScript
//   5. npm run lint        - ESLint
//   6. npm run build       - production build incl. the Content-Security-Policy (VERIFICATION build: uses a placeholder
//                            Supabase address unless VITE_SUPABASE_URL is set; never deploy this dist folder)
//   7. dist checks         - SPA routing (no 404.html), _headers with a filled-in policy, no localhost, no eval/new Function,
//                            and the server-secret scan: every finding with position, masked match, context, fingerprint and
//                            (via a temporary source-mapped rebuild) the original source file
//   8. bundle size         - every file in dist/assets with gzip size; initial JavaScript total
//   9. npm audit           - production dependencies and all dependencies (report only; never `npm audit fix --force`)
// It writes release-check-report.md (and .json) next to package.json and never changes source files, never deploys,
// never contacts Supabase or Cloudflare. Exit code 0 only if every step passed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import zlib from 'node:zlib'; import crypto from 'node:crypto'; import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLACEHOLDER_URL = 'https://verification-build.supabase.co';
const LIMITS = { initialJsGzipKb: 400, anyFileGzipKb: 300 };   // warnings, not failures

// ---------- server-secret scan of the built site ----------
// "secret" rules match the SHAPE of a real credential: such a finding always fails and can never be allowlisted.
// "mention" rules match words that name a server credential (e.g. service_role). A mention is not a key by itself, but it
// still fails until a person has reviewed that exact occurrence and recorded it in scripts/secret-scan-allowlist.json
// (fingerprint + reason). Every finding is reported with its position, a masked copy and the surrounding code.
export const SECRET_RULES = [
  { id: 'private-key', kind: 'secret', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { id: 'supabase-secret-key', kind: 'secret', re: /(?<![A-Za-z0-9_])sb_secret_[A-Za-z0-9_-]{16,}/g },
  { id: 'resend-api-key', kind: 'secret', re: /(?<![A-Za-z0-9_])re_[A-Za-z0-9_]{20,}/g },
  { id: 'stripe-live-key', kind: 'secret', re: /(?<![A-Za-z0-9_])[rs]k_live_[A-Za-z0-9]{16,}/g },
  { id: 'service-role-key-value', kind: 'secret', re: /SUPABASE_SERVICE_ROLE_KEY["']?\s*[:=]\s*["'][^"'\s]{20,}["']/g },
  { id: 'server-credential-mention', kind: 'mention', re: /service_role|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY|sb_secret_/g },
];
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g;

/** Masks anything key-shaped: keeps a recognisable prefix and the length, never the secret part. */
export function maskSecrets(text) {
  return text
    .replace(/(?<![A-Za-z0-9_])(sb_secret_|re_|[rs]k_live_)([A-Za-z0-9_-]{4,})/g, (m, pre, body) => `${pre}${body.slice(0, 2)}…[${body.length} chars masked]`)
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, (m) => `eyJ…[JWT, ${m.length} chars masked]`)
    .replace(/-----BEGIN ([A-Z ]*)PRIVATE KEY-----[\s\S]{0,4000}?(-----END [A-Z ]*PRIVATE KEY-----|$)/g, '-----BEGIN $1PRIVATE KEY-----…[masked]');
}

function lineCol(text, offset) {
  let line = 1, last = -1;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) { line++; last = i; }
  return { line, column: offset - last - 1 };
}

/** All findings in one text. Each: rule, kind, offset, line, column, masked match, masked context, fingerprint. */
export function scanText(text, rel) {
  const found = [];
  const add = (rule, kind, index, match, extra = {}) => {
    const ctxStart = Math.max(0, index - 60), ctxEnd = Math.min(text.length, index + match.length + 60);
    const context = text.slice(ctxStart, ctxEnd);
    const fingerprint = crypto.createHash('sha256').update(`${rule}\n${match}\n${context}`).digest('hex').slice(0, 16);
    found.push({ file: rel, rule, kind, offset: index, ...lineCol(text, index), match: maskSecrets(match), context: maskSecrets(context).replace(/\s+/g, ' '), fingerprint, ...extra });
  };
  for (const r of SECRET_RULES) for (const m of text.matchAll(r.re)) add(r.id, r.kind, m.index, m[0]);
  for (const m of text.matchAll(JWT_RE)) {
    let role; try { role = JSON.parse(Buffer.from(m[1], 'base64url').toString()).role; } catch { continue; }
    if (role && role !== 'anon') add('supabase-jwt-not-anon', 'secret', m.index, m[0], { role });
  }
  // a mention inside a secret finding is the same finding
  return found.filter((f) => f.kind === 'secret' || !found.some((g) => g.kind === 'secret' && f.offset >= g.offset && f.offset < g.offset + 80));
}

export function loadAllowlist(file) {
  if (!fs.existsSync(file)) return [];
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return (data.entries ?? []).filter((e) => e && typeof e.fingerprint === 'string' && typeof e.reason === 'string' && e.reason.trim().length >= 20);
}

// --- source maps: map a position in the built file back to the original source file (diagnostics only) ---
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function decodeVlq(segment) {
  const out = []; let value = 0, shift = 0;
  for (const ch of segment) {
    let digit = B64.indexOf(ch); const more = digit & 32; digit &= 31; value += digit << shift;
    if (more) shift += 5; else { out.push(value & 1 ? -(value >> 1) : value >> 1); value = 0; shift = 0; }
  }
  return out;
}
/** line is 1-based, column 0-based (as in scanText). Returns { source, line, column } of the original code, or null. */
export function originalPosition(map, line, column) {
  let src = 0, sLine = 0, sCol = 0, best = null; const lines = map.mappings.split(';');
  for (let l = 0; l < lines.length && l < line; l++) {
    let gCol = 0;
    for (const seg of lines[l].split(',')) {
      if (!seg) continue; const f = decodeVlq(seg); gCol += f[0];
      if (f.length >= 4) { src += f[1]; sLine += f[2]; sCol += f[3]; if (l === line - 1 && gCol <= column) best = { source: map.sources[src], line: sLine + 1, column: sCol }; }
    }
  }
  if (best) best.source = best.source.replace(/^(\.\.\/)+/, '').replace(/^.*node_modules\//, 'node_modules/');
  return best;
}
/** Finds each finding again in a source-mapped build (same code, built with --sourcemap) and adds its original source file. */
export function attachSources(findings, mappedDist) {
  const js = [];
  const walk = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]) : [];
  for (const f of walk(mappedDist)) if (f.endsWith('.js') && fs.existsSync(f + '.map')) js.push({ file: f, text: fs.readFileSync(f, 'utf8'), map: JSON.parse(fs.readFileSync(f + '.map', 'utf8')) });
  for (const finding of findings) {
    for (const b of js) {
      const hits = scanText(b.text, '').filter((h) => h.rule === finding.rule && h.context === finding.context);
      if (!hits.length) continue;
      const pos = originalPosition(b.map, hits[0].line, hits[0].column);
      if (pos) { finding.source = pos; break; }
    }
  }
  return findings;
}

export function describeFinding(f) {
  const where = f.source ? `; source ${f.source.source}:${f.source.line}` : '';
  return `${f.file}:${f.line}:${f.column} [${f.rule}${f.role ? ` role=${f.role}` : ''}] match "${f.match}" fingerprint ${f.fingerprint}${where}\n      context: …${f.context}…`;
}

export function analyseDist(dist, opts = {}) {
  const problems = [], warnings = [], files = [], findings = [];
  const allow = opts.allowlist ?? [];
  const exists = (p) => fs.existsSync(path.join(dist, p));
  if (!exists('index.html')) problems.push('dist/index.html is missing');
  if (exists('404.html')) problems.push('dist/404.html exists: Cloudflare Pages would stop serving index.html for app routes (SPA)');
  if (!exists('_headers')) problems.push('dist/_headers is missing (security headers)');
  else {
    const h = fs.readFileSync(path.join(dist, '_headers'), 'utf8');
    if (h.includes('__CONTENT_SECURITY_POLICY__')) problems.push('dist/_headers still has the policy placeholder (scripts/write-headers.mjs did not run)');
    if (!/Content-Security-Policy: default-src 'self'/.test(h)) problems.push('dist/_headers has no Content-Security-Policy');
    if (/unsafe-inline|unsafe-eval/.test(h)) problems.push("the Content-Security-Policy contains 'unsafe-inline' or 'unsafe-eval'");
  }
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const all = fs.existsSync(dist) ? walk(dist) : [];
  for (const f of all) {
    const rel = path.relative(dist, f).split(path.sep).join('/'); const buf = fs.readFileSync(f);
    const text = /\.(js|css|html|map|json|txt)$/.test(f) ? buf.toString('utf8') : '';
    if (text) {
      for (const f of scanText(text, rel)) findings.push(f);
      if (/\bhttps?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(text) && rel.endsWith('.js')) warnings.push(`${rel}: mentions a localhost address (check it is only the development fallback)`);
      if (rel.endsWith('.js') && /\beval\(|new Function\(/.test(text)) warnings.push(`${rel}: uses eval/new Function - the Content-Security-Policy blocks these; check the feature in the browser`);
      if (rel.endsWith('.map')) warnings.push(`${rel}: source map published (exposes source code; fine for an open project, otherwise disable)`);
    }
    if (rel.startsWith('assets/')) files.push({ file: rel, bytes: buf.length, gzip: zlib.gzipSync(buf, { level: 9 }).length, brotli: zlib.brotliCompressSync(buf).length });
  }
  files.sort((a, b) => b.gzip - a.gzip);
  let initial = [];
  if (exists('index.html')) {
    const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    const refs = [...html.matchAll(/(?:src|href)="\/?(assets\/[^"]+\.js)"/g)].map((m) => m[1]);
    initial = files.filter((f) => refs.includes(f.file));
  }
  const initialGzip = initial.reduce((s, f) => s + f.gzip, 0);
  if (initialGzip / 1024 > LIMITS.initialJsGzipKb) warnings.push(`initial JavaScript is ${(initialGzip / 1024).toFixed(0)} KB gzip (above ${LIMITS.initialJsGzipKb} KB): consider lazy-loading large pages (charts)`);
  for (const f of files) if (f.gzip / 1024 > LIMITS.anyFileGzipKb) warnings.push(`${f.file} is ${(f.gzip / 1024).toFixed(0)} KB gzip`);
  for (const f of findings) {
    const entry = f.kind === 'mention' ? allow.find((e) => e.fingerprint === f.fingerprint) : undefined;   // real key shapes are never allowlisted
    if (entry) { f.allowed = entry.reason; warnings.push(`reviewed mention (allowlisted: ${entry.reason}): ${describeFinding(f)}`); }
    else problems.push(`${f.kind === 'secret' ? 'SERVER SECRET' : 'server-credential mention, not reviewed'}: ${describeFinding(f)}`);
  }
  return { problems, warnings, files, findings, initial: initial.map((f) => f.file), initialGzip, totalGzip: files.reduce((s, f) => s + f.gzip, 0) };
}

// ---------- Cloudflare Workers deployment configuration (wrangler.jsonc) ----------
/** Parses JSONC (comments and trailing commas) without a dependency. */
export function parseJsonc(text) {
  let out = '', inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (inStr) { out += c; if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; out += c; continue; }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; out += '\n'; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; continue; }
    out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** Checks the static-site Workers configuration; viteOutDir defaults to Vite's "dist". */
export function checkWranglerConfig(root, { viteOutDir = 'dist', today = new Date() } = {}) {
  const problems = [], notes = [];
  const file = ['wrangler.jsonc', 'wrangler.json', 'wrangler.toml'].find((f) => fs.existsSync(path.join(root, f)));
  if (!file) return { problems: ['no wrangler.jsonc: `wrangler deploy` would run automatic configuration (needs Vite 6+ and rewrites the project)'], notes };
  if (file === 'wrangler.toml') return { problems: ['wrangler.toml found: this check expects wrangler.jsonc'], notes };
  let c; try { c = parseJsonc(fs.readFileSync(path.join(root, file), 'utf8')); } catch (e) { return { problems: [`${file} is not valid JSON(C): ${e.message}`], notes }; }
  if (typeof c.name !== 'string' || !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(c.name)) problems.push('"name" must be the Worker name (lowercase letters, digits, dashes)');
  const d = typeof c.compatibility_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c.compatibility_date) ? new Date(c.compatibility_date + 'T00:00:00Z') : null;
  if (!d || isNaN(d)) problems.push('"compatibility_date" must be a date YYYY-MM-DD');
  else if (d > today) problems.push(`"compatibility_date" ${c.compatibility_date} is in the future`);
  const dir = c.assets?.directory;
  if (!dir) problems.push('"assets.directory" is missing');
  else if (path.resolve(root, dir) !== path.resolve(root, viteOutDir)) problems.push(`"assets.directory" (${dir}) is not the Vite build folder (${viteOutDir})`);
  if (c.assets?.not_found_handling !== 'single-page-application') problems.push('"assets.not_found_handling" must be "single-page-application" (deep links such as /cohorts/123 would return 404)');
  if (c.main) problems.push('"main" is set: a Worker script would answer requests and its responses would NOT get the _headers security headers');
  if (c.assets?.run_worker_first) problems.push('"assets.run_worker_first" is set: requests would bypass the static-asset _headers rules');
  for (const k of ['vars', 'secrets']) if (c[k] && Object.keys(c[k]).length) problems.push(`"${k}" in ${file}: keep configuration and secrets out of the repository (set build variables in the Cloudflare dashboard)`);
  notes.push(`${file}: Worker "${c.name}", assets ${dir}, ${c.assets?.not_found_handling}, compatibility ${c.compatibility_date}`);
  return { problems, notes, config: c };
}

export function summariseAudit(json) {
  if (!json || typeof json !== 'object') return { ok: false, text: 'npm audit gave no readable result' };
  const v = json.metadata?.vulnerabilities ?? {};
  const list = Object.values(json.vulnerabilities ?? {}).map((x) => ({ name: x.name, severity: x.severity, direct: x.isDirect,
    via: (x.via ?? []).map((y) => (typeof y === 'string' ? y : y.title + (y.url ? ` (${y.url})` : ''))).join('; '),
    fix: x.fixAvailable === false ? 'no fix available' : x.fixAvailable === true ? 'fix within the allowed versions (npm audit fix)' :
      `fix needs ${x.fixAvailable?.name}@${x.fixAvailable?.version}${x.fixAvailable?.isSemVerMajor ? ' (BREAKING major upgrade - review before changing)' : ''}` }));
  const serious = (v.high ?? 0) + (v.critical ?? 0);
  return { ok: serious === 0, counts: v, list };
}

function run(label, cmd, opts = {}) {
  const started = Date.now();
  const r = spawnSync(cmd, { cwd: ROOT, shell: true, encoding: 'utf8', env: { ...process.env, ...(opts.env ?? {}) }, maxBuffer: 64 * 1024 * 1024 });
  const out = ((r.stdout ?? '') + (r.stderr ?? '')).trim();
  return { label, cmd, ok: r.status === 0, status: r.status, seconds: Math.round((Date.now() - started) / 1000), tail: out.split('\n').slice(-40).join('\n'), stdout: r.stdout ?? '' };
}

function main() {
  const steps = []; const report = { date: new Date().toISOString(), node: process.version, steps };
  const want = fs.readFileSync(path.join(ROOT, '.nvmrc'), 'utf8').trim();
  const nodeOk = process.versions.node.split('.')[0] === want;
  steps.push({ label: `Node.js ${want} (.nvmrc)`, ok: nodeOk, tail: `running ${process.version}` + (nodeOk ? '' : ` - install Node ${want} (Cloudflare builds with it)`) });
  let stop = !nodeOk;
  const wr = checkWranglerConfig(ROOT); report.wrangler = wr;
  steps.push({ label: 'Cloudflare Workers configuration (wrangler.jsonc)', ok: wr.problems.length === 0, tail: [...wr.problems.map((p) => 'PROBLEM: ' + p), ...wr.notes].join('\n') });
  const lock = path.join(ROOT, 'package-lock.json');
  if (!stop && !fs.existsSync(lock)) {
    const s = run('package-lock.json created by npm install (commit this file)', 'npm install --no-audit --no-fund');
    steps.push(s); stop = !s.ok; report.lockCreated = s.ok;
  }
  for (const [label, cmd, env] of [
    ['npm ci (clean install from the lock file)', 'npm ci --no-audit --no-fund'],
    ['TypeScript (npm run typecheck)', 'npm run typecheck'],
    ['ESLint (npm run lint)', 'npm run lint'],
    ['production build (npm run build, Node ' + want + ')', 'npm run build', { VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || PLACEHOLDER_URL, VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || 'verification-build-public-key' }],
  ]) { if (stop) { steps.push({ label, ok: false, skipped: true, tail: 'not run: an earlier step failed' }); continue; } const s = run(label, cmd, { env }); steps.push(s); if (!s.ok && label.startsWith('npm ci')) stop = true; if (!s.ok && label.startsWith('production')) stop = true; }
  if (!stop) {
    const a = analyseDist(path.join(ROOT, 'dist'), { allowlist: loadAllowlist(path.join(ROOT, 'scripts', 'secret-scan-allowlist.json')) }); report.dist = a;
    const open = a.findings.filter((f) => !f.allowed);
    if (open.length) {   // locate the original source of each finding: rebuild the same code with source maps into a temporary folder
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dira-sourcemap-'));
      const env = { VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || PLACEHOLDER_URL, VITE_SUPABASE_ANON_KEY: process.env.VITE_SUPABASE_ANON_KEY || 'verification-build-public-key' };
      const r = run('source-mapped diagnostic build', `npx vite build --sourcemap --outDir "${tmp}" --emptyOutDir --logLevel error`, { env });
      if (r.ok) { attachSources(open, tmp); a.problems = a.problems.map((p) => { const f = open.find((x) => p.includes(x.fingerprint)); return f?.source ? p.replace(/fingerprint (\w+)/, `fingerprint $1; source ${f.source.source}:${f.source.line}`) : p; }); }
      else a.warnings.push('could not make the source-mapped diagnostic build: ' + r.tail.split('\n').slice(-3).join(' '));
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    steps.push({ label: 'dist checks (SPA routing, headers, policy, secrets)', ok: a.problems.length === 0, tail: [...a.problems.map((p) => 'PROBLEM: ' + p), ...a.warnings.map((w) => 'warning: ' + w)].join('\n') || 'no problems' });
    steps.push({ label: 'bundle size', ok: true, tail: `initial JavaScript ${(a.initialGzip / 1024).toFixed(1)} KB gzip; all assets ${(a.totalGzip / 1024).toFixed(1)} KB gzip` });
  } else steps.push({ label: 'dist checks and bundle size', ok: false, skipped: true, tail: 'not run: no build' });
  const hasModules = fs.existsSync(path.join(ROOT, 'node_modules'));
  for (const [label, cmd, key] of [['npm audit - production dependencies', 'npm audit --omit=dev --json', 'auditProd'], ['npm audit - all dependencies (incl. build tools)', 'npm audit --json', 'auditAll']]) {
    if (!hasModules) { steps.push({ label, ok: false, skipped: true, tail: 'not run: no installed packages' }); continue; }
    const s = run(label, cmd); let parsed = null; try { parsed = JSON.parse(s.stdout); } catch { /* keep null */ }
    const sum = summariseAudit(parsed); report[key] = sum;
    steps.push({ label, ok: sum.ok, tail: sum.counts ? `critical ${sum.counts.critical ?? 0}, high ${sum.counts.high ?? 0}, moderate ${sum.counts.moderate ?? 0}, low ${sum.counts.low ?? 0}\n` + (sum.list ?? []).map((x) => `- ${x.severity} ${x.name}${x.direct ? ' (direct)' : ''}: ${x.via} -> ${x.fix}`).join('\n') : sum.text });
  }
  const md = ['# DIRA LEARN release check', '', `Date: ${report.date}  Node: ${report.node}`, '',
    '| Step | Result |', '|---|---|', ...steps.map((s) => `| ${s.label} | ${s.skipped ? 'NOT RUN' : s.ok ? 'PASS' : 'FAIL'} |`), '',
    ...steps.flatMap((s) => [`## ${s.label}: ${s.skipped ? 'NOT RUN' : s.ok ? 'PASS' : 'FAIL'}`, '', s.cmd ? '`' + s.cmd + '`' : '', '', '```', s.tail ?? '', '```', '']),
    ...(report.dist ? ['## Bundle (largest first)', '', '| File | Size | gzip | brotli |', '|---|---|---|---|', ...report.dist.files.map((f) => `| ${f.file}${report.dist.initial.includes(f.file) ? ' (initial)' : ''} | ${(f.bytes / 1024).toFixed(1)} KB | ${(f.gzip / 1024).toFixed(1)} KB | ${(f.brotli / 1024).toFixed(1)} KB |`)] : []),
    '', report.lockCreated ? '**package-lock.json was created: commit it to the repository.**' : '',
    'The dist folder of this check is a verification build: deploy only through Cloudflare Pages with the real variables.'].join('\n');
  fs.writeFileSync(path.join(ROOT, 'release-check-report.md'), md + '\n');
  fs.writeFileSync(path.join(ROOT, 'release-check-report.json'), JSON.stringify(report, (k, v) => (k === 'stdout' ? undefined : v), 2));
  const failed = steps.filter((s) => !s.ok);
  for (const s of steps) console.log(`${s.skipped ? 'NOT RUN' : s.ok ? 'PASS   ' : 'FAIL   '} ${s.label}`);
  console.log(failed.length ? `\n${failed.length} step(s) did not pass - see release-check-report.md` : '\nALL RELEASE CHECKS PASSED - see release-check-report.md');
  process.exitCode = failed.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
