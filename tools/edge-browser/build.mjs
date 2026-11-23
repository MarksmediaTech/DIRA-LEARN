// Bundles each real Edge Function (supabase/functions/<name>/index.ts) for Node, with supabase-js replaced by
// fake-supabase.mjs. Usage: node build.mjs <project> <outdir>
import { build } from '/opt/npm-tools/node_modules/esbuild/lib/main.js';
import path from 'node:path';
const [proj, out] = process.argv.slice(2); const here = path.dirname(new URL(import.meta.url).pathname);
export const FUNCTIONS = ['invite-user', 'import-learners', 'convert-application', 'bootstrap-first-admin', 'complete-enrolment', 'google-calendar-sync', 'send-emails', 'set-account-status', 'scan-attachments'];
for (const f of FUNCTIONS) {
  await build({ entryPoints: [path.join(proj, 'supabase/functions', f, 'index.ts')], bundle: true, format: 'esm', platform: 'node', outfile: path.join(out, f + '.mjs'),
    logLevel: 'error', plugins: [{ name: 'fake-supabase', setup(b) { b.onResolve({ filter: /^https:\/\/esm\.sh\/@supabase\/supabase-js/ }, () => ({ path: path.join(here, 'fake-supabase.mjs') })); } }] });
}
