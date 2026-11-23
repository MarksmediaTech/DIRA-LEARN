import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/features/auth/AuthProvider';
import { toCsv } from '@/features/me/rules';
import { PERIOD_LABEL, attendanceRate, average, countByMonth, display, periodRange, retention, scorePercent, type Period } from './rules';

interface Raw {
  users: number; funnel: { status: string; total: number }[]; cohorts: { id: string; name: string; programme_id: string }[]; programmes: { id: string; name: string }[];
  enrols: { participant_id: string; cohort_id: string; track_name: string | null; status: string }[];
  attendance: { status: string; cohort_id: string; starts_at: string }[];
  scores: { score: number | null; max: number | null; cohort_id: string }[];
  certs: { cohort_id: string; issued_on: string; revoked: boolean }[];
}
const PURPLE = '#4C1D95'; const ORANGE = '#FE7613';
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function AnalyticsPage() {
  const { profile } = useAuth();
  const hideApplications = profile?.role === 'me_officer';  // the M&E role cannot read application records
  const [period, setPeriod] = useState<Period>('30d');
  const [programmeId, setProgrammeId] = useState('');
  const [cohortId, setCohortId] = useState('');
  const range = useMemo(() => periodRange(period, new Date()), [period]);

  const q = useQuery({
    queryKey: ['analytics', period],
    queryFn: async (): Promise<Raw> => {
      const [u, f, c, p, e, a, s, ce] = await Promise.all([
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('v_application_funnel').select('status, total'),
        supabase.from('cohorts').select('id, name, programme_id').order('start_date', { ascending: false }),
        supabase.from('programmes').select('id, name'),
        supabase.from('cohort_enrolments').select('participant_id, cohort_id, tracks(name), participants(status)'),
        supabase.from('attendance').select('status, session_schedules!inner(cohort_id, starts_at)').gte('session_schedules.starts_at', range.from.toISOString()).lt('session_schedules.starts_at', range.to.toISOString()),
        supabase.from('submissions').select('score, assignments!inner(max_score, cohort_id)').not('score', 'is', null),
        supabase.from('certificates').select('cohort_id, issued_on, revoked'),
      ]);
      for (const r of [u, f, c, p, e, a, s, ce]) if (r.error) throw r.error;
      return {
        users: u.count ?? 0, funnel: f.data as Raw['funnel'], cohorts: c.data as Raw['cohorts'], programmes: p.data as Raw['programmes'],
        enrols: (e.data as unknown as { participant_id: string; cohort_id: string; tracks: { name: string } | null; participants: { status: string } | null }[]).map((x) => ({ participant_id: x.participant_id, cohort_id: x.cohort_id, track_name: x.tracks?.name ?? null, status: x.participants?.status ?? '' })),
        attendance: (a.data as unknown as { status: string; session_schedules: { cohort_id: string; starts_at: string } }[]).map((x) => ({ status: x.status, cohort_id: x.session_schedules.cohort_id, starts_at: x.session_schedules.starts_at })),
        scores: (s.data as unknown as { score: number | null; assignments: { max_score: number | null; cohort_id: string } }[]).map((x) => ({ score: x.score, max: x.assignments.max_score, cohort_id: x.assignments.cohort_id })),
        certs: ce.data as Raw['certs'],
      };
    },
  });

  const d = useMemo(() => {
    const raw = q.data; if (!raw) return null;
    const cohorts = raw.cohorts.filter((c) => (!programmeId || c.programme_id === programmeId) && (!cohortId || c.id === cohortId));
    const ids = new Set(cohorts.map((c) => c.id));
    const enrols = raw.enrols.filter((x) => ids.has(x.cohort_id));
    const people = new Map(enrols.map((x) => [x.participant_id, x.status]));
    const att = raw.attendance.filter((x) => ids.has(x.cohort_id));
    const sc = raw.scores.filter((x) => ids.has(x.cohort_id));
    const certs = raw.certs.filter((x) => ids.has(x.cohort_id));
    const certDates = certs.filter((x) => !x.revoked).map((x) => new Date(`${x.issued_on}T00:00:00`));
    const withdrawn = [...people.values()].filter((s) => s === 'withdrawn').length;
    const byTrack = new Map<string, number>(); for (const x of enrols) byTrack.set(x.track_name ?? 'No track yet', (byTrack.get(x.track_name ?? 'No track yet') ?? 0) + 1);
    const funnel = (s: string) => raw.funnel.find((f) => f.status === s)?.total ?? 0;
    return {
      kpi: {
        users: raw.users, active: [...people.values()].filter((s) => s === 'enrolled' || s === 'active').length, pending: funnel('submitted') + funnel('under_review'), approved: funnel('accepted'),
        enrolled: people.size, attendance: attendanceRate(att), assessment: average(sc.map((x) => scorePercent(x.score, x.max))),
        certs: certs.filter((x) => !x.revoked && new Date(`${x.issued_on}T00:00:00`) >= range.from && new Date(`${x.issued_on}T00:00:00`) < range.to).length,
        completed: [...people.values()].filter((s) => s === 'completed' || s === 'graduated' || s === 'alumni').length, ...retention(people.size, withdrawn),
      },
      funnel: raw.funnel.map((f) => ({ name: f.status.replace(/_/g, ' '), total: f.total })),
      tracks: [...byTrack].map(([name, total]) => ({ name, total })),
      cohortAttendance: cohorts.map((c) => ({ name: c.name, rate: attendanceRate(att.filter((x) => x.cohort_id === c.id)) })).filter((x) => x.rate !== null),
      cohortScores: cohorts.map((c) => ({ name: c.name, avg: average(sc.filter((x) => x.cohort_id === c.id).map((x) => scorePercent(x.score, x.max))) })).filter((x) => x.avg !== null),
      certMonths: countByMonth(certDates, range.from, range.to),
    };
  }, [q.data, programmeId, cohortId, range]);

  const exportCsv = () => {
    if (!d) return;
    const k = d.kpi;
    const csv = toCsv(['Measure', 'Value'], [
      ['Period', `${iso(range.from)} to ${iso(new Date(range.to.getTime() - 86400000))}`], ['Registered user accounts', k.users], ['Active participants', k.active], ['Pending applications (all time)', k.pending], ['Approved applications (all time)', k.approved],
      ['Enrolled in selection', k.enrolled], ['Attendance rate %', k.attendance], ['Average assignment score %', k.assessment], ['Certificates issued in period', k.certs], ['Completed or graduated', k.completed], ['Retention %', k.retention], ['Dropout %', k.dropout],
      ...d.cohortAttendance.map((c) => [`Attendance % - ${c.name}`, c.rate] as [string, number | null]),
      ...d.cohortScores.map((c) => [`Average score % - ${c.name}`, c.avg] as [string, number | null]),
    ]);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `dira-learn-analytics-${iso(new Date())}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  if (q.isLoading) return <p role="status">Loading…</p>;
  if (q.isError || !d || !q.data) return <p role="alert" className="text-danger">Could not load analytics.</p>;
  const cohortOptions = q.data.cohorts.filter((c) => !programmeId || c.programme_id === programmeId);
  const kpis: [string, string, string?][] = [
    ['Registered accounts', String(d.kpi.users)], ['Active participants', String(d.kpi.active)], ['Pending applications', hideApplications ? 'Not visible' : String(d.kpi.pending), hideApplications ? 'Your role cannot read applications' : 'All time'], ['Approved applications', hideApplications ? 'Not visible' : String(d.kpi.approved), hideApplications ? 'Your role cannot read applications' : 'All time'],
    ['Enrolled', String(d.kpi.enrolled)], ['Attendance rate', display(d.kpi.attendance, '%'), 'In the period'], ['Average assignment score', display(d.kpi.assessment, '%'), 'Graded work with a mark'], ['Certificates issued', String(d.kpi.certs), 'In the period'],
    ['Completed or graduated', String(d.kpi.completed)], ['Retention', display(d.kpi.retention, '%')], ['Dropout', display(d.kpi.dropout, '%')],
  ];
  return (
    <section className="grid max-w-6xl gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <h1 className="text-2xl font-bold text-purple-700">Analytics</h1>
        <div className="flex gap-2"><Button type="button" variant="quiet" onClick={exportCsv}>Export CSV (opens in Excel)</Button><Button type="button" variant="quiet" onClick={() => window.print()}>Print or save as PDF</Button></div>
      </div>
      <h1 className="hidden text-2xl font-bold print:block">DIRA Learn analytics report · {new Date().toLocaleDateString()}</h1>
      <div className="flex flex-wrap gap-3 print:hidden">
        <label className="grid gap-1 text-sm font-medium">Period<select value={period} onChange={(e) => setPeriod(e.target.value as Period)} className="rounded-control border border-purple-200 px-3 py-2 font-normal">{(Object.keys(PERIOD_LABEL) as Period[]).map((p) => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-medium">Programme<select value={programmeId} onChange={(e) => { setProgrammeId(e.target.value); setCohortId(''); }} className="rounded-control border border-purple-200 px-3 py-2 font-normal"><option value="">All</option>{q.data.programmes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-medium">Cohort<select value={cohortId} onChange={(e) => setCohortId(e.target.value)} className="rounded-control border border-purple-200 px-3 py-2 font-normal"><option value="">All</option>{cohortOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
      </div>
      <p className="text-sm text-ink/70">Every figure is calculated from the records in the database. &ldquo;No data&rdquo; means there is nothing to calculate from yet; it is never shown as zero. Period: {iso(range.from)} to {iso(new Date(range.to.getTime() - 86400000))}.</p>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {kpis.map(([l, v, h]) => <div key={l} className="rounded-card border border-purple-100 p-4"><dt className="text-sm text-ink/70">{l}</dt><dd className="font-display text-2xl font-bold text-purple-700">{v}</dd>{h && <p className="text-xs text-ink/60">{h}</p>}</div>)}
      </dl>
      <div className="grid gap-6 lg:grid-cols-2">
        <Chart title="Applications by status (all time)" empty={!d.funnel.length}><BarChart data={d.funnel}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="total" name="Applications" fill={PURPLE} /></BarChart></Chart>
        <Chart title="Participants by track" empty={!d.tracks.length}><BarChart data={d.tracks}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="total" name="Participants" fill={ORANGE} /></BarChart></Chart>
        <Chart title="Attendance rate by cohort (%)" empty={!d.cohortAttendance.length}><BarChart data={d.cohortAttendance}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis domain={[0, 100]} /><Tooltip /><Bar dataKey="rate" name="Attendance %" fill={PURPLE} /></BarChart></Chart>
        <Chart title="Average assignment score by cohort (%)" empty={!d.cohortScores.length}><BarChart data={d.cohortScores}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis domain={[0, 100]} /><Tooltip /><Bar dataKey="avg" name="Average %" fill={ORANGE} /></BarChart></Chart>
        <Chart title="Certificates issued per month" empty={!d.certMonths.some((m) => m.count > 0)}><LineChart data={d.certMonths}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis allowDecimals={false} /><Tooltip /><Legend /><Line type="monotone" dataKey="count" name="Certificates" stroke={PURPLE} strokeWidth={2} /></LineChart></Chart>
      </div>
      <p className="text-xs text-ink/60">Not included: trainer performance (no agreed measure), pre/post-training assessments and learning outcomes (no such data is collected yet), participant engagement beyond attendance and submissions.</p>
    </section>
  );
}

function Chart({ title, empty, children }: { title: string; empty: boolean; children: React.ReactElement }) {
  return (
    <figure className="rounded-card border border-purple-100 p-4">
      <figcaption className="mb-2 font-display text-base font-semibold">{title}</figcaption>
      {empty ? <p className="py-10 text-center text-sm text-ink/60">No data for this selection yet.</p> : <div className="h-64"><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>}
    </figure>
  );
}
