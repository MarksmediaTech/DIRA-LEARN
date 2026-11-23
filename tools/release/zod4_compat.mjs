// Zod 4 compatibility test for the two schema files (no npm needed): runs the CURRENT schemas on Zod 3 and the same schemas,
// converted to Zod 4 syntax the way the planned upgrade would change them, on the Zod 4 engine bundled in zod 3.25 ("zod/v4").
// Compares, for many inputs, whether each form is accepted and which message each field shows. Usage: node zod4_compat.mjs <project>
import { build } from '/opt/npm-tools/node_modules/esbuild/lib/main.js';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const proj = path.resolve(process.argv[2]); const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'zod4-'));
const ZOD = '/opt/npm-tools/node_modules/zod';
export const toV4 = (src, guid) => src
  .replace("from 'zod';", "from 'zod/v4';")
  .replace(/\{ invalid_type_error: ('[^']+') \}/g, '{ error: $1 }')
  .replace(/\{ errorMap: \(\) => \(\{ message: ('[^']+') \}\) \}/g, '{ error: $1 }')
  .replace(/z\.string\(\)\.uuid\(/g, guid ? 'z.guid(' : 'z.string().uuid(');
const variants = { v3: (s) => s, v4: (s) => toV4(s, true), 'v4 with .uuid()': (s) => toV4(s, false) };
const mods = {};
for (const [name, tf] of Object.entries(variants)) {
  const d = path.join(tmp, name.replace(/\W/g, '_')); fs.cpSync(path.join(proj, 'src'), d, { recursive: true });
  for (const f of ['features/applications/schema.ts', 'features/cohorts/schema.ts']) fs.writeFileSync(path.join(d, f), tf(fs.readFileSync(path.join(proj, 'src', f), 'utf8')));
  fs.writeFileSync(path.join(d, 'entry.ts'), "export * from './features/applications/schema'; export * from './features/cohorts/schema';");
  await build({ entryPoints: [path.join(d, 'entry.ts')], bundle: true, format: 'esm', platform: 'node', outfile: path.join(d, 'out.mjs'), alias: { zod: ZOD }, nodePaths: ['/opt/npm-tools/node_modules'], logLevel: 'error' });
  mods[name] = await import(path.join(d, 'out.mjs'));
}
const iso = (yearsAgo) => { const d = new Date(); d.setFullYear(d.getFullYear() - yearsAgo); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); };
const goodApp = { firstName: 'Akinyi', lastName: 'Otieno', dateOfBirth: iso(20), phone: '+254 712 345 678', location: 'Kisumu', educationLevel: 'diploma',
  institution: '', skills: 'Canva, Excel', interests: '', preferredTrackId: '53654f36-bf96-4894-a05e-6d550cd65783', motivation: 'x'.repeat(60), consent: true };
const app = [goodApp, { ...goodApp, firstName: '' }, { ...goodApp, dateOfBirth: iso(17) }, { ...goodApp, dateOfBirth: iso(26) }, { ...goodApp, dateOfBirth: 'nonsense' },
  { ...goodApp, phone: 'abc' }, { ...goodApp, educationLevel: 'phd' }, { ...goodApp, educationLevel: undefined }, { ...goodApp, consent: false }, { ...goodApp, consent: undefined },
  { ...goodApp, motivation: 'short' }, { ...goodApp, motivation: 'x'.repeat(1501) }, { ...goodApp, preferredTrackId: '' }, { ...goodApp, preferredTrackId: 'not-a-uuid' },
  { ...goodApp, preferredTrackId: '00000000-0000-0000-0000-0000000000a1' }, { ...goodApp, skills: '  ab ' }, { ...goodApp, location: undefined }, {}];
const goodCohort = { name: 'Nairobi Jan 2027', startDate: '2027-01-10', endDate: '2027-02-10', capacity: '30', intakeLabel: '', season: '', recruitmentOpensOn: '', recruitmentClosesOn: '', accessOpensAt: '', accessClosesAt: '' };
const cohort = [goodCohort, { ...goodCohort, capacity: 'abc' }, { ...goodCohort, capacity: '' }, { ...goodCohort, capacity: '2.5' }, { ...goodCohort, capacity: '0' }, { ...goodCohort, capacity: '501' },
  { ...goodCohort, endDate: '2027-01-01' }, { ...goodCohort, recruitmentOpensOn: '2026-12-10', recruitmentClosesOn: '2026-12-01' },
  { ...goodCohort, accessOpensAt: '2027-01-10T08:00', accessClosesAt: '2027-01-09T08:00' }, { ...goodCohort, name: ' a ' }, {}];
const goodSched = { curriculumSessionId: '533ac291-5542-46f2-96de-1a3434f04adf', trainerId: '', startsAt: '2027-01-10T09:00', endsAt: '2027-01-10T11:00', mode: 'online', venue: '', meetingUrl: 'https://meet.example.org/x' };
const sched = [goodSched, { ...goodSched, curriculumSessionId: '' }, { ...goodSched, curriculumSessionId: '11111111-0000-0000-0000-000000000002' }, { ...goodSched, trainerId: 'd1a00000-0000-0000-0000-000000000006' },
  { ...goodSched, mode: 'tv' }, { ...goodSched, meetingUrl: 'javascript:alert(1)' }, { ...goodSched, meetingUrl: '' }, {}];
const outcome = (schema, input) => { const r = schema.safeParse(input); if (r.success) return 'OK ' + JSON.stringify(r.data);
  const byField = {}; for (const i of r.error.issues) { const k = i.path.join('.') || '(form)'; (byField[k] ??= []).push(i.message); }
  return 'ERR ' + JSON.stringify(Object.fromEntries(Object.entries(byField).sort().map(([k, v]) => [k, v[0]]))); };
const results = [];
for (const [label, key, inputs] of [['application form', 'applicationSchema', app], ['cohort form', 'cohortSchema', cohort], ['session schedule form', 'scheduleSchema', sched]]) {
  for (const v of ['v4', 'v4 with .uuid()']) {
    const diffs = inputs.map((inp, i) => [i, outcome(mods.v3[key], inp), outcome(mods[v][key], inp)]).filter(([, a, b]) => a !== b);
    results.push({ label, v, total: inputs.length, diffs });
  }
}
for (const r of results) {
  console.log(`${r.diffs.length ? 'DIFF' : 'SAME'}  ${r.label}, Zod 4 ${r.v === 'v4' ? '(z.guid() for ids)' : '(.uuid() kept)'}: ${r.total - r.diffs.length}/${r.total} inputs identical`);
  for (const [i, a, b] of r.diffs) console.log(`        input #${i}\n          Zod 3: ${a.slice(0, 300)}\n          Zod 4: ${b.slice(0, 300)}`);
}
fs.rmSync(tmp, { recursive: true });
process.exit(results.filter((r) => r.v === 'v4').every((r) => r.diffs.length === 0) ? 0 : 1);
