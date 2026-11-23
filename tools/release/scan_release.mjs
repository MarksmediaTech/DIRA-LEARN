// Usage: node tools/release/scan_release.mjs <extracted-release-folder>
// Release safety scan (21 Nov 2026). Uses the same secret rules as scripts/release-check.mjs (private keys, Supabase secret
// keys, service-role key values, non-anon Supabase JWTs, Resend and Stripe live keys) on EVERY text file of the release,
// and refuses files that must never be shipped: .env files with values, key files, database dumps and backups,
// node_modules, build output, local Supabase state, test reports. Exit 1 on any finding.
import fs from 'node:fs';
import path from 'node:path';
import { scanText, loadAllowlist } from '../../scripts/release-check.mjs';

const root = path.resolve(process.argv[2] ?? '.');
const allow = new Set(loadAllowlist(path.join(root, 'scripts', 'secret-scan-allowlist.json')).map((e) => e.fingerprint));
const FORBIDDEN = [
  [/(^|\/)\.env(\.[a-z]+)?$/i, (rel) => !/\.env\.example$/i.test(rel), '.env file (only .env.example may be shipped)'],
  [/\.(pem|key|p12|pfx|jks)$/i, () => true, 'key or certificate file'],
  [/(^|\/)id_(rsa|ed25519|ecdsa)(\.pub)?$/, () => true, 'SSH key'],
  [/\.(dump|backup|bak)$|(^|\/)backup_[^/]*\.sql$|(^|\/)[^/]*_before\.sql$/i, () => true, 'database dump or backup'],
  [/(^|\/)(node_modules|dist|coverage|test-results|playwright-report|\.vite|\.wrangler)(\/|$)/, () => true, 'dependency, build or test output'],
  [/(^|\/)supabase\/(\.temp|\.branches)(\/|$)/, () => true, 'local Supabase state'],
  [/(^|\/)\.dev\.vars$/, () => true, 'Wrangler local secrets file'],
];
const findings = [], forbidden = [];
let files = 0, scanned = 0;
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name), rel = path.relative(root, full).split(path.sep).join('/');
    if (e.isDirectory()) {
      const hit = FORBIDDEN.find(([re, extra]) => re.test(rel + '/') && extra(rel));
      if (hit) { forbidden.push(`${rel}/ - ${hit[2]}`); continue; }
      walk(full); continue;
    }
    files++;
    const hit = FORBIDDEN.find(([re, extra]) => re.test(rel) && extra(rel));
    if (hit) { forbidden.push(`${rel} - ${hit[2]}`); continue; }
    const buf = fs.readFileSync(full);
    if (buf.length > 5_000_000 || buf.includes(0)) continue;          // binary (images) or very large
    scanned++;
    for (const f of scanText(buf.toString('utf8'), rel)) if (f.kind === 'secret' && !allow.has(f.fingerprint)) findings.push(f);
  }
}
walk(root);
console.log(`release safety scan: ${files} files, ${scanned} text files scanned; ${findings.length} secrets, ${forbidden.length} forbidden files`);
// never print a secret: only the rule, the place and the length of the match
for (const f of findings) console.log(`  SECRET ${f.rule} in ${f.file}:${f.line} (${f.match.length} characters, value not shown)`);
for (const f of forbidden) console.log(`  FORBIDDEN ${f}`);
process.exit(findings.length || forbidden.length ? 1 : 0);
