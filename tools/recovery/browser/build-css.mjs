// Builds the app's CSS for the screen harness with the locally available Tailwind v4 compiler, loading the project's
// v3 config through @config (v4's compatibility layer). Test harness only; the release build uses the project's own Tailwind 3.
import { compile } from '/opt/npm-tools/node_modules/tailwindcss/dist/lib.mjs';
import { transform } from '/opt/npm-tools/node_modules/esbuild/lib/main.js';
import fs from 'node:fs'; import path from 'node:path';
const [proj, out] = process.argv.slice(2); const tw = '/opt/npm-tools/node_modules/tailwindcss';
const cfgSrc = (await transform(fs.readFileSync(path.join(proj, 'tailwind.config.ts'), 'utf8'), { loader: 'ts', format: 'esm' })).code;
const cfgFile = path.join(out, 'tw.config.mjs'); fs.writeFileSync(cfgFile, cfgSrc);
const css = fs.readFileSync(path.join(proj, 'src/index.css'), 'utf8').replace(/@tailwind base;\s*@tailwind components;\s*@tailwind utilities;/, '@import "tailwindcss";\n@config "./cfg";');
const c = await compile(css, { base: proj,
  loadStylesheet: async (id) => { const f = id === 'tailwindcss' ? path.join(tw, 'index.css') : path.join(tw, id.replace(/^tailwindcss\//, '')); return { path: f, base: path.dirname(f), content: fs.readFileSync(f, 'utf8') }; },
  loadModule: async () => ({ path: cfgFile, base: out, module: (await import(cfgFile)).default }) });
// 23 Nov 2026: brackets, parentheses and commas are kept inside a candidate so arbitrary values such as bg-[linear-gradient(100deg,#1E0B3D_0%,...)] are found (as the real Tailwind scanner does)
const cands = new Set(); const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(tsx?|html)$/.test(e.name)) for (const m of fs.readFileSync(p, 'utf8').match(/[^\s"'`{}<>;]+/g) ?? []) cands.add(m); } };
walk(path.join(proj, 'src'));
fs.writeFileSync(path.join(out, 'app.css'), c.build([...cands]));
console.log('css', fs.statSync(path.join(out, 'app.css')).size);
