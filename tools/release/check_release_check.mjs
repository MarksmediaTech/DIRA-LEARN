// Self-test of scripts/release-check.mjs on SYNTHETIC dist folders and audit outputs (no packages needed).
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import zlib from 'node:zlib';
const proj = path.resolve(process.argv[2]);
const { analyseDist, summariseAudit, scanText, maskSecrets, attachSources, originalPosition, checkWranglerConfig, parseJsonc } = await import(path.join(proj, 'scripts', 'release-check.mjs'));
const results = []; const ok = (c, m) => results.push([Boolean(c), m]);
function dist(files) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-')); for (const [f, c] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c); } return d; }
const html = '<!doctype html><script type="module" crossorigin src="/assets/index-abc.js"></script><link rel="stylesheet" href="/assets/index-abc.css">';
const headers = "/*\n  Content-Security-Policy: default-src 'self'; script-src 'self'\n";
const jwt = (role) => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ role, iss: 'supabase' })).toString('base64url') + '.c2lnbmF0dXJlc2lnbmF0dXJl';
let a = analyseDist(dist({ 'index.html': html, '_headers': headers, 'assets/index-abc.js': 'console.log(1);' + 'x'.repeat(5000) + jwt('anon'), 'assets/index-abc.css': 'body{}', 'assets/chart-1.js': 'y'.repeat(9000) }));
ok(a.problems.length === 0, 'a correct build has no problems (the public anon key is allowed)');
ok(a.initial.length === 1 && a.initial[0] === 'assets/index-abc.js', 'the initial JavaScript is found from index.html');
ok(a.files.length === 3 && a.files.every((f) => f.gzip > 0 && f.brotli > 0 && f.bytes > 0), 'every asset is measured (size and gzip)');
a = analyseDist(dist({ 'index.html': html, '404.html': 'x', '_headers': headers }));
ok(a.problems.some((p) => p.includes('404.html')), 'a 404.html (would break app routes on Cloudflare) is reported');
a = analyseDist(dist({ 'index.html': html, '_headers': '/*\n  Content-Security-Policy: __CONTENT_SECURITY_POLICY__\n' }));
ok(a.problems.some((p) => p.includes('placeholder')), 'an unfilled policy placeholder is reported');
a = analyseDist(dist({ 'index.html': html, '_headers': "/*\n  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'\n" }));
ok(a.problems.some((p) => p.includes('unsafe-inline')), "'unsafe-inline' in the policy is reported");
a = analyseDist(dist({ 'index.html': html, '_headers': headers, 'assets/index-abc.js': 'const k="' + jwt('service_role') + '"' }));
ok(a.problems.some((p) => p.includes('service_role')), 'a service-role key in the site is reported');
a = analyseDist(dist({ 'index.html': html, '_headers': headers, 'assets/index-abc.js': 'new Function("return 1")' }));
ok(a.warnings.some((w) => w.includes('eval/new Function')), 'eval/new Function (blocked by the policy) is flagged');
const big = (await import('node:crypto')).randomBytes(700000).toString('base64');   // incompressible ~930 KB
a = analyseDist(dist({ 'index.html': html, '_headers': headers, 'assets/index-abc.js': big }));
ok(a.warnings.some((w) => w.includes('initial JavaScript')), 'a large initial bundle gives a size warning');
ok(a.problems.length === 0 && analyseDist(dist({})).problems.some((p) => p.includes('index.html')), 'a missing index.html is a problem');
// ----- server-secret scan: diagnostics, masking, strictness, allowlist, source location -----
const SECRET_BODY = 'AbCdEfGhIjKlMnOpQrStUvWx123456';
a = analyseDist(dist({ 'index.html': html, '_headers': headers, 'assets/index-abc.js': 'var k="sb_secret_' + SECRET_BODY + '";' }));
ok(a.problems.length === 1 && a.problems[0].startsWith('SERVER SECRET') && a.problems[0].includes('supabase-secret-key'), 'a real sb_secret_ key fails, named by rule');
ok(!a.problems.join('\n').includes(SECRET_BODY) && a.problems[0].includes('chars masked'), 'the report never prints the secret part (masked, with length)');
ok(/index-abc\.js:1:\d+ /.test(a.problems[0]) && /fingerprint [0-9a-f]{16}/.test(a.problems[0]) && a.problems[0].includes('context: …'), 'each finding has file:line:column, a fingerprint and the surrounding code');
const fp = a.findings[0].fingerprint;
a = analyseDist(dist({ 'index.html': html, '_headers': headers, 'assets/index-abc.js': 'var k="sb_secret_' + SECRET_BODY + '";' }), { allowlist: [{ fingerprint: fp, reason: 'trying to allowlist a real key - must not work' }] });
ok(a.problems.length === 1, 'a real key cannot be allowlisted');
a = analyseDist(dist({ 'index.html': html, '_headers': headers, 'assets/index-abc.js': 'var r="re_' + SECRET_BODY + '";' }));
ok(a.problems.some((p) => p.includes('resend-api-key')), 'a Resend key fails');
a = analyseDist(dist({ 'index.html': html, '_headers': headers, 'assets/index-abc.js': 'function signature_abcdefghijklmnopqrstuvwxyz(){}' }));
ok(a.problems.length === 0, 'an identifier that merely contains "re_" (e.g. signature_...) is not taken for a Resend key');
const lib = 'function c(k){if(typeof k=="string"&&k.startsWith("sb_secret_"))throw new Error("Use the publishable key in browsers, never a service_role or secret key")}';
a = analyseDist(dist({ 'index.html': html, '_headers': headers, 'assets/index-abc.js': lib }));
ok(a.problems.length >= 1 && a.problems.every((p) => p.startsWith('server-credential mention, not reviewed')), 'a library that only NAMES service_role/sb_secret_ still fails until reviewed - reported as a mention, not a key');
ok(a.problems.some((p) => p.includes('match "sb_secret_"')) && a.problems.some((p) => p.includes('match "service_role"')), 'the matched words are shown');
a = analyseDist(dist({ 'index.html': html, '_headers': headers, 'assets/index-abc.js': lib }), { allowlist: a.findings.map((f) => ({ fingerprint: f.fingerprint, reason: 'reviewed: supabase-js guard that refuses secret keys in browsers' })) });
ok(a.problems.length === 0 && a.warnings.some((w) => w.startsWith('reviewed mention')), 'after review (fingerprint + reason) the mention becomes a listed warning');
ok(analyseDist(dist({ 'index.html': html, '_headers': headers, 'assets/index-abc.js': lib }), { allowlist: [] }).problems.length >= 1, 'without an allowlist entry the mention fails');
ok(maskSecrets('x ' + jwt('service_role') + ' y').includes('JWT') && !maskSecrets(jwt('service_role')).includes('eyJhbGciOiJIUzI1NiJ9.ey'), 'JWTs are masked in context');
// source location through a real minified, source-mapped bundle (esbuild)
const { build } = await import('/opt/npm-tools/node_modules/esbuild/lib/main.js');
const proj2 = fs.mkdtempSync(path.join(os.tmpdir(), 'smap-'));
fs.mkdirSync(path.join(proj2, 'node_modules', 'fake-auth'), { recursive: true }); fs.mkdirSync(path.join(proj2, 'src'));
fs.writeFileSync(path.join(proj2, 'node_modules', 'fake-auth', 'index.js'), '// a library\nexport function check(key) {\n  if (typeof key === "string" && key.startsWith("sb_secret_")) {\n    throw new Error("secret keys are not allowed in a browser");\n  }\n  return key;\n}\n');
fs.writeFileSync(path.join(proj2, 'src', 'main.js'), 'import { check } from "fake-auth";\nconsole.log(check(globalThis.k));\n');
const out = path.join(proj2, 'dist', 'assets'); fs.mkdirSync(out, { recursive: true });
await build({ entryPoints: [path.join(proj2, 'src', 'main.js')], bundle: true, minify: true, outfile: path.join(out, 'index-x.js'), sourcemap: false, absWorkingDir: proj2, logLevel: 'silent' });
const mapped = path.join(proj2, 'mapped', 'assets'); fs.mkdirSync(mapped, { recursive: true });
await build({ entryPoints: [path.join(proj2, 'src', 'main.js')], bundle: true, minify: true, outfile: path.join(mapped, 'index-x.js'), sourcemap: true, absWorkingDir: proj2, logLevel: 'silent' });
const found = scanText(fs.readFileSync(path.join(out, 'index-x.js'), 'utf8'), 'assets/index-x.js');
attachSources(found, path.join(proj2, 'mapped'));
ok(found.length === 1 && found[0].source && found[0].source.source === 'node_modules/fake-auth/index.js' && found[0].source.line === 3, `the original source file and line are found from the source-mapped rebuild (${found[0]?.source?.source}:${found[0]?.source?.line})`);
ok(originalPosition({ mappings: '', sources: [] }, 1, 0) === null, 'no mapping -> no invented location');
fs.rmSync(proj2, { recursive: true });

// ----- Cloudflare Workers configuration -----
const real = checkWranglerConfig(proj);
ok(real.problems.length === 0 && real.config?.assets?.directory === './dist', `the project's wrangler.jsonc is a valid static-site configuration (${real.notes[0] ?? real.problems.join('; ')})`);
const wdir = (text) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-')); if (text !== null) fs.writeFileSync(path.join(d, 'wrangler.jsonc'), text); return d; };
const good = '{ "name": "dira-learn", "compatibility_date": "2026-11-01", "assets": { "directory": "./dist", "not_found_handling": "single-page-application" } }';
ok(checkWranglerConfig(wdir(null)).problems[0].includes('automatic configuration'), 'a missing wrangler.jsonc is reported (Wrangler would auto-configure and need Vite 6)');
ok(checkWranglerConfig(wdir(good.replace('"assets"', '"main": "src/worker.ts", "assets"'))).problems.some((p) => p.includes('"main"')), 'a Worker script (would bypass the _headers security headers) is reported');
ok(checkWranglerConfig(wdir(good.replace('./dist', './build'))).problems.some((p) => p.includes('not the Vite build folder')), 'an assets folder other than dist is reported');
ok(checkWranglerConfig(wdir(good.replace('single-page-application', 'none'))).problems.some((p) => p.includes('single-page-application')), 'missing SPA routing (deep links 404) is reported');
ok(checkWranglerConfig(wdir(good.replace('2026-11-01', '2999-01-01'))).problems.some((p) => p.includes('future')), 'a compatibility date in the future is reported');
ok(checkWranglerConfig(wdir(good.replace('"assets"', '"vars": { "SUPABASE_SERVICE_ROLE_KEY": "x" }, "assets"'))).problems.some((p) => p.includes('"vars"')), 'variables or secrets in the file are reported');
ok(checkWranglerConfig(wdir(good.replace('"not_found_handling"', '"run_worker_first": true, "not_found_handling"'))).problems.some((p) => p.includes('run_worker_first')), 'run_worker_first is reported');
ok(checkWranglerConfig(wdir('{ "name": "Bad Name", "assets": {} }')).problems.length >= 3, 'an invalid name, date and assets block are reported');
ok(JSON.stringify(parseJsonc('// c\n{ "u": "https://x.org/a//b", /* block */ "a": [1, 2,], }')) === '{"u":"https://x.org/a//b","a":[1,2]}', 'JSONC comments and trailing commas are handled; // inside strings is kept');

let s = summariseAudit({ metadata: { vulnerabilities: { critical: 0, high: 0, moderate: 2, low: 1 } }, vulnerabilities: { esbuild: { name: 'esbuild', severity: 'moderate', isDirect: false, via: [{ title: 'dev server issue', url: 'https://example' }], fixAvailable: { name: 'vite', version: '7.0.0', isSemVerMajor: true } } } });
ok(s.ok && s.list[0].fix.includes('BREAKING'), 'moderate findings pass; a fix that needs a major upgrade is marked BREAKING (not applied)');
s = summariseAudit({ metadata: { vulnerabilities: { critical: 0, high: 1 } }, vulnerabilities: {} });
ok(!s.ok, 'a high or critical finding fails the check');
ok(!summariseAudit(null).ok, 'an unreadable audit result fails the check');
for (const [g, m] of results) console.log(`${g ? 'PASS' : 'FAIL'}  ${m}`);
console.log(`release-check self-test (synthetic builds): ${results.filter((r) => r[0]).length}/${results.length} checks passed`);
process.exit(results.every((r) => r[0]) ? 0 : 1);
