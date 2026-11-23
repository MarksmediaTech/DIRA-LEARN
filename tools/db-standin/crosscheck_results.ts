// Integration check: the database calculation (learner_metrics, migration 27) must give the same results as the
// TypeScript rules the Results page uses (src/features/results/rules.ts), for the Phase 6 test fixture.
// Usage: tsx crosscheck_results.ts <project-dir>   (needs the local PostgreSQL on /tmp:54322 with migrations applied)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const proj = process.argv[2] ?? '.';
const psql = (db: string, sql: string) => execFileSync('psql', ['-h', '/tmp', '-p', '54322', '-U', 'postgres', '-d', db, '-X', '-q', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
const test = readFileSync(path.join(proj, 'supabase/tests/learner_performance.test.sql'), 'utf8');
const fixture = test.slice(test.indexOf('-- FIXTURE START'), test.indexOf('-- FIXTURE END'));

// a throw-away copy of the migrated database, with the fixture committed into it
psql('template1', 'drop database if exists crosscheck with (force)');
psql('template1', 'create database crosscheck template postgres');
execFileSync('psql', ['-h', '/tmp', '-p', '54322', '-U', 'postgres', '-d', 'crosscheck', '-X', '-q', '-v', 'ON_ERROR_STOP=1'], { input: fixture, encoding: 'utf8' });

const cohort = '66662222-0000-0000-0000-00000000000a';
const j = (sql: string) => JSON.parse(psql('crosscheck', `select coalesce(json_agg(t), '[]') from (${sql}) t`));
const enrols = j(`select participant_id, track_id from cohort_enrolments where cohort_id = '${cohort}'`);
const schedules = j(`select ss.id, ss.curriculum_session_id, ss.status, cs.track_id from session_schedules ss join curriculum_sessions cs on cs.id = ss.curriculum_session_id where ss.cohort_id = '${cohort}'`);
const attendance = j(`select a.schedule_id, a.participant_id, a.status from attendance a join session_schedules ss on ss.id = a.schedule_id where ss.cohort_id = '${cohort}'`);
const assignments = j(`select id, track_id, component, max_score from assignments where cohort_id = '${cohort}'`);
const submissions = j(`select s.assignment_id, s.participant_id, s.attempt, s.status, s.score from submissions s join assignments a on a.id = s.assignment_id where a.cohort_id = '${cohort}'`);
const recipientsRows = j(`select r.assignment_id, r.participant_id from assignment_recipients r join assignments a on a.id = r.assignment_id where a.cohort_id = '${cohort}'`);
const sqlRows = j(`select * from _learner_metrics('${cohort}')`);
psql('template1', 'drop database if exists crosscheck with (force)');

const { summariseResult, completionChecks } = await import(path.resolve(proj, 'src/features/results/rules.ts'));
const { isAssignedTo, recipientMap } = await import(path.resolve(proj, 'src/features/assignments/rules.ts'));
const recipients = recipientMap(recipientsRows);
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

// --- the same steps as ResultsPage.tsx ---
const coreCount = new Set(schedules.filter((x: any) => x.track_id == null).map((x: any) => x.curriculum_session_id)).size;
let checked = 0; const problems: string[] = [];
for (const en of enrols) {
  const mySchedules = schedules.filter((x: any) => x.status !== 'cancelled' && (x.track_id == null || x.track_id === en.track_id));
  const byId = new Map(mySchedules.map((x: any) => [x.id, x]));
  const myAtt = attendance.filter((x: any) => x.participant_id === en.participant_id && byId.has(x.schedule_id));
  const myAssignments = assignments.filter((x: any) => (x.track_id === null || x.track_id === en.track_id) && isAssignedTo(x.id, en.participant_id, recipients));
  const mySubs = submissions.filter((x: any) => x.participant_id === en.participant_id);
  const r = summariseResult({
    attendance: myAtt.map((x: any) => x.status),
    assignments: myAssignments.map((x: any) => ({ id: x.id, component: x.component, maxScore: num(x.max_score) })),
    submissions: mySubs.map((x: any) => ({ assignmentId: x.assignment_id, attempt: x.attempt, status: x.status, score: num(x.score) })),
  });
  const submitted = (c: string) => myAssignments.filter((x: any) => x.component === c).some((x: any) => mySubs.some((s: any) => s.assignment_id === x.id));
  const c = completionChecks({
    sessions: myAtt.map((x: any) => ({ curriculumSessionId: (byId.get(x.schedule_id) as any).curriculum_session_id, isCore: (byId.get(x.schedule_id) as any).track_id == null, status: x.status })),
    coreSessionCount: coreCount, finalProjectSubmitted: submitted('final_project'), reflectionSubmitted: submitted('reflection'),
  });
  const s = sqlRows.find((x: any) => x.participant_id === en.participant_id);
  const pairs: [string, unknown, unknown][] = [
    ['attendance', r.engagement, num(s.attendance_rate)], ['tasks %', r.tasks.percent, num(s.tasks_pct)], ['tasks graded', r.tasks.graded, s.tasks_graded],
    ['tasks total', r.tasks.total, s.tasks_total], ['final %', r.finalProject.percent, num(s.final_pct)], ['final graded', r.finalProject.graded, s.final_graded],
    ['reflection %', r.reflection.percent, num(s.reflection_pct)], ['overall', r.overall, num(s.overall)], ['provisional', r.provisional, s.provisional],
    ['completion met', c.allMet, s.completion_met], ['core total', coreCount, s.core_total],
  ];
  for (const [k, ts, sq] of pairs) { checked++; if (ts !== sq) problems.push(`${s.participant_no} ${k}: TypeScript ${JSON.stringify(ts)} vs database ${JSON.stringify(sq)}`); }
}
console.log(`cross-check: ${checked} figures compared for ${enrols.length} learners, ${problems.length} differences`);
for (const p of problems) console.log('  DIFFERENCE ' + p);
process.exit(problems.length ? 1 : 0);
