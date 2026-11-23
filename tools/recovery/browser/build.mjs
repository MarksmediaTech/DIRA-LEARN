// Bundles the harness with esbuild (no npm install needed). Usage: node build.mjs <project> <outdir>
import { build } from '/opt/npm-tools/node_modules/esbuild/lib/main.js';
import path from 'node:path';
const [proj, out] = process.argv.slice(2); const here = path.dirname(new URL(import.meta.url).pathname);
const nm = '/opt/npm-tools/node_modules';
await build({
  entryPoints: [path.join(here, process.env.HARNESS_ENTRY ?? 'harness.tsx')], bundle: true, outfile: path.join(out, 'app.js'), format: 'esm', jsx: 'automatic',
  loader: { '.png': 'dataurl', '.jpg': 'dataurl', '.jpeg': 'dataurl', '.webp': 'dataurl', '.svg': 'dataurl' }, nodePaths: [nm], logLevel: 'error',
  define: { 'import.meta.env.VITE_PUBLIC_SITE_URL': 'undefined', 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'aliases', setup(b) {
    b.onResolve({ filter: /^@\/lib\/supabase$/ }, () => ({ path: path.join(here, process.env.HARNESS_FAKE ?? 'fake-supabase.ts') }));
    b.onResolve({ filter: /^react-router-dom$/ }, () => ({ path: path.join(here, 'router-shim.tsx') }));
    b.onResolve({ filter: /^@tanstack\/react-query$/ }, () => ({ path: path.join(here, 'react-query-shim.tsx') }));
    b.onResolve({ filter: /^lucide-react$/ }, () => ({ path: path.join(here, 'icons-shim.tsx') }));
    b.onResolve({ filter: /^(recharts|react-hook-form|@hookform\/resolvers\/zod)$/ }, () => ({ path: path.join(here, 'missing-shim.tsx') }));
    b.onResolve({ filter: /\.css$/ }, () => ({ path: 'css', namespace: 'empty' }));
    b.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: '', loader: 'js' }));
    b.onResolve({ filter: /^@\// }, (a) => b.resolve('./' + a.path.slice(2), { resolveDir: path.join(proj, 'src'), kind: a.kind }));
  } }],
});
