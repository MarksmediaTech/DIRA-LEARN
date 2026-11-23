import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { REASON_LABEL, STATUS_LABEL, pct, toNum, type CompletionStatus, type SupportReason } from '@/features/performance/rules';
import {
  TAB_LABEL, distinct, downloadCsv, hoursText, meanOf, tableCsv, tabsFor, versusAverage,
  type CompareRow, type FacilitatorRow, type IntakeRow, type SupportRow, type Tab,
} from './rules';

// Phase 7 (migration 28). Aggregates from the database; individual learners only for programme staff and executives.
const field = 'rounded-control border border-purple-200 px-3 py-2 font-normal';
const PURPLE = '#4C1D95'; const ORANGE = '#FE7613'; const GREY = '#6B7280';
interface LearnerRow { cohort_id: string; cohort_name: string; participant_id: string; participant_no: string; display_name: string; track_name: string | null;
  participant_status: string; access_status: string; attendance_rate: number | string | null; submitted: number; assignments_expected: number; overdue: number;
  overall: number | string | null; completion_status: CompletionStatus; needs_support: boolean; support_reasons: SupportReason[] | null }
interface SgRow { cohort_name: string; open_count: number; acknowledged_or_active: number; resolved_or_closed: number; urgent: number; overdue_ack: number; legal_holds: number }

function useRpc<T>(name: string, enabled = true) {
  return useQuery({ queryKey: ['ci', name], enabled, queryFn: async () => { const { data, error } = await supabase.rpc(name); if (error) throw error; return (data ?? []) as T[]; } });
}

export function IntelligencePage() {
  const { profile } = useAuth();
  const tabs = tabsFor(profile?.role);
  const [tab, setTab] = useState<Tab>('compare');
  const [season, setSeason] = useState(''); const [intake, setIntake] = useState('');
  const intakeQ = useRpc<IntakeRow>('ci_intake', tabs.length > 0);
  const position = useQuery({ queryKey: ['sg-me-position'], queryFn: async () => { const { data } = await supabase.rpc('sg_my_position'); return (data as string | null) ?? null; } });

  // the season / intake filter applies to every tab, through the cohort ids it leaves
  const cohortIds = useMemo(() => new Set((intakeQ.data ?? []).filter((c) => (!season || c.season === season) && (!intake || c.intake_label === intake)).map((c) => c.cohort_id)), [intakeQ.data, season, intake]);
  if (tabs.length === 0) return <EmptyState title="Not available">Cohort Intelligence is for programme staff, executives and M&E officers.</EmptyState>;
  const active: Tab = tabs.includes(tab) ? tab : tabs[0] ?? 'compare';

  return (
    <section className="grid max-w-7xl gap-5">
      <h1 className="text-2xl font-bold text-purple-700">Cohort Intelligence</h1>
      <p className="rounded-card border border-amber-300 bg-amber-50 p-3 text-sm">
        Figures use the same <strong>draft</strong> rules as learners&apos; own results (weights, completion requirements and &quot;may need support&quot; thresholds await approval).
        Averages leave out learners with nothing recorded, so a missing figure never counts as zero. – means no data.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm font-medium">Season<select className={field} value={season} onChange={(e) => setSeason(e.target.value)}><option value="">All</option>{distinct((intakeQ.data ?? []).map((c) => c.season)).map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-medium">Intake<select className={field} value={intake} onChange={(e) => setIntake(e.target.value)}><option value="">All</option>{distinct((intakeQ.data ?? []).map((c) => c.intake_label)).map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        <span className="pb-2 text-sm text-ink/60">{cohortIds.size} cohort(s)</span>
      </div>
      <div role="tablist" aria-label="Reports" className="flex flex-wrap gap-2 border-b border-purple-100 pb-2">
        {tabs.map((t) => <button key={t} type="button" role="tab" aria-selected={active === t} onClick={() => setTab(t)} className={`rounded-control px-3 py-1.5 text-sm font-semibold ${active === t ? 'bg-purple-600 text-white' : 'bg-purple-50 text-purple-700'}`}>{TAB_LABEL[t]}</button>)}
      </div>
      {intakeQ.isError && <p role="alert" className="text-danger">Could not load the reports.</p>}
      <div role="tabpanel">
        {active === 'intake' && <IntakeTab rows={(intakeQ.data ?? []).filter((r) => cohortIds.has(r.cohort_id))} />}
        {active === 'compare' && <CompareTab ids={cohortIds} />}
        {active === 'facilitators' && <FacilitatorsTab ids={cohortIds} />}
        {active === 'learners' && <LearnersTab ids={cohortIds} />}
        {active === 'support' && <SupportTab ids={cohortIds} officer={Boolean(position.data)} />}
      </div>
    </section>
  );
}

function Table({ caption, head, children }: { caption: string; head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead><tr className="border-b border-purple-200">{head.map((h) => <th key={h} scope="col" className="p-2">{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function IntakeTab({ rows }: { rows: IntakeRow[] }) {
  if (rows.length === 0) return <EmptyState title="No cohorts">No cohort matches these filters.</EmptyState>;
  const csv = () => downloadCsv('intake-report', tableCsv(rows, [
    { label: 'Cohort', value: (r) => r.cohort_name }, { label: 'Intake', value: (r) => r.intake_label }, { label: 'Season', value: (r) => r.season },
    { label: 'Starts', value: (r) => r.start_date }, { label: 'Capacity', value: (r) => r.capacity }, { label: 'Enrolled', value: (r) => r.enrolled },
    { label: 'Fill %', value: (r) => r.fill_pct }, { label: 'Withdrawn', value: (r) => r.withdrawn }, { label: 'Applications in window', value: (r) => r.applications_in_window },
    { label: 'Accepted', value: (r) => r.accepted_in_window }, { label: 'Rejected', value: (r) => r.rejected_in_window },
    { label: 'Tracks', value: (r) => r.tracks.map((t) => `${t.track}: ${t.learners}`).join('; ') },
  ]));
  return (
    <div className="grid gap-3">
      <Button variant="quiet" className="justify-self-start" onClick={csv}>Download CSV</Button>
      <Table caption="Intake by cohort" head={['Cohort', 'Recruitment window', 'Places', 'Enrolled', 'Withdrawn', 'Applications in window', 'Tracks']}>
        {rows.map((r) => (
          <tr key={r.cohort_id} className="border-b border-purple-100 align-top">
            <th scope="row" className="p-2 font-medium">{r.cohort_name}<div className="text-xs font-normal text-ink/60">{[r.intake_label, r.season].filter(Boolean).join(' · ') || '–'}</div></th>
            <td className="p-2 text-xs">{r.recruitment_opens_on && r.recruitment_closes_on ? `${r.recruitment_opens_on} to ${r.recruitment_closes_on}` : 'Not set'}</td>
            <td className="p-2">{r.capacity}</td>
            <td className="p-2">{r.enrolled} <span className="text-xs text-ink/60">({pct(r.fill_pct)})</span></td>
            <td className="p-2">{r.withdrawn}</td>
            <td className="p-2">{r.applications_in_window === null ? '–' : `${r.applications_in_window} (${r.accepted_in_window} accepted, ${r.rejected_in_window} rejected)`}</td>
            <td className="p-2 text-xs">{r.tracks.map((t) => `${t.track}: ${t.learners}`).join(', ') || '–'}</td>
          </tr>
        ))}
      </Table>
      <p className="text-xs text-ink/60">Applications are programme-wide, so they are counted by submission date inside each cohort&apos;s recruitment window. M&amp;E officers do not see application counts.</p>
    </div>
  );
}

function CompareTab({ ids }: { ids: Set<string> }) {
  const q = useRpc<CompareRow>('ci_cohort_comparison');
  const [showTracks, setShowTracks] = useState(false);
  const rows = (q.data ?? []).filter((r) => ids.has(r.cohort_id) && (showTracks || r.level === 'cohort'));
  const cohortRows = rows.filter((r) => r.level === 'cohort');
  const avg = { att: meanOf(cohortRows, 'avg_attendance'), sub: meanOf(cohortRows, 'submission_rate'), comp: meanOf(cohortRows, 'completion_rate'), overall: meanOf(cohortRows, 'avg_overall') };
  const chart = cohortRows.slice(0, 12).reverse().map((r) => ({ name: r.cohort_name, Attendance: toNum(r.avg_attendance), Submission: toNum(r.submission_rate), Completion: toNum(r.completion_rate) }));
  if (q.isLoading) return <p role="status">Loading…</p>;
  if (q.isError) return <p role="alert" className="text-danger">Could not load the comparison.</p>;
  if (rows.length === 0) return <EmptyState title="No cohorts">No cohort matches these filters.</EmptyState>;
  const csv = () => downloadCsv('cohort-comparison', tableCsv(rows, [
    { label: 'Cohort', value: (r) => r.cohort_name }, { label: 'Track', value: (r) => (r.level === 'track' ? r.track_name : 'All tracks') },
    { label: 'Learners', value: (r) => r.learners }, { label: 'Active', value: (r) => r.active_learners }, { label: 'Withdrawn', value: (r) => r.withdrawn },
    { label: 'Average attendance %', value: (r) => r.avg_attendance }, { label: 'Submission rate %', value: (r) => r.submission_rate }, { label: 'Overdue', value: (r) => r.overdue },
    { label: 'Average tasks %', value: (r) => r.avg_tasks }, { label: 'Average final project %', value: (r) => r.avg_final }, { label: 'Average overall % (draft)', value: (r) => r.avg_overall },
    { label: 'Learners with an overall', value: (r) => r.results_count }, { label: 'Requirements met', value: (r) => r.requirements_met }, { label: 'Certified', value: (r) => r.certified },
    { label: 'Completion %', value: (r) => r.completion_rate }, { label: 'May need support', value: (r) => r.needs_support },
  ]));
  return (
    <div className="grid gap-4">
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {([['Average attendance', avg.att], ['Submission rate', avg.sub], ['Completion', avg.comp], ['Average overall (draft)', avg.overall]] as [string, number | null][]).map(([k, v]) => (
          <div key={k} className="rounded-card bg-purple-50 p-3"><dt className="text-xs text-ink/60">{k} across cohorts</dt><dd className="text-lg font-semibold">{pct(v)}</dd></div>
        ))}
      </dl>
      {chart.length > 0 && (
        <figure className="h-72 rounded-card border border-purple-100 p-2">
          <figcaption className="sr-only">Attendance, submission and completion rates by cohort (the table below has the same figures)</figcaption>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chart}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis domain={[0, 100]} unit="%" /><Tooltip /><Legend />
              <Bar dataKey="Attendance" fill={PURPLE} /><Bar dataKey="Submission" fill={ORANGE} /><Bar dataKey="Completion" fill={GREY} /></BarChart>
          </ResponsiveContainer>
        </figure>
      )}
      <div className="flex flex-wrap gap-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showTracks} onChange={(e) => setShowTracks(e.target.checked)} /> Show each track</label>
        <Button variant="quiet" onClick={csv}>Download CSV</Button>
      </div>
      <Table caption="Cohort and track comparison" head={['Cohort / track', 'Learners', 'Attendance', 'Submission', 'Overall (draft)', 'Completion', 'May need support']}>
        {rows.map((r) => {
          const vs = r.level === 'cohort' ? versusAverage(r.avg_attendance, avg.att) : null;
          return (
            <tr key={`${r.cohort_id}-${r.track_id ?? 'all'}-${r.level}`} className={`border-b border-purple-100 align-top ${r.level === 'track' ? 'text-ink/80' : ''}`}>
              <th scope="row" className={`p-2 ${r.level === 'track' ? 'pl-6 font-normal' : 'font-medium'}`}>{r.level === 'track' ? r.track_name : r.cohort_name}</th>
              <td className="p-2">{r.active_learners}{r.withdrawn ? <span className="text-xs text-ink/60"> (+{r.withdrawn} withdrawn)</span> : null}</td>
              <td className="p-2">{pct(r.avg_attendance)}{vs && vs.points !== 0 ? <span className="block text-xs text-ink/60">{vs.label}</span> : null}</td>
              <td className="p-2">{pct(r.submission_rate)}{r.overdue ? <span className="block text-xs text-danger">{r.overdue} overdue</span> : null}</td>
              <td className="p-2">{pct(r.avg_overall)} <span className="text-xs text-ink/60">({r.results_count} with a result)</span></td>
              <td className="p-2">{pct(r.completion_rate)} <span className="text-xs text-ink/60">({r.requirements_met} met, {r.certified} certified)</span></td>
              <td className="p-2">{r.needs_support}</td>
            </tr>
          );
        })}
      </Table>
    </div>
  );
}

function FacilitatorsTab({ ids }: { ids: Set<string> }) {
  const q = useRpc<FacilitatorRow>('ci_facilitators');
  const [who, setWho] = useState('');
  const all = (q.data ?? []).filter((r) => ids.has(r.cohort_id));
  const rows = all.filter((r) => !who || r.trainer_id === who);
  const people = [...new Map(all.map((r) => [r.trainer_id, r.trainer_name])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  if (q.isLoading) return <p role="status">Loading…</p>;
  if (q.isError) return <p role="alert" className="text-danger">Could not load the facilitator report.</p>;
  const csv = () => downloadCsv('facilitators', tableCsv(rows, [
    { label: 'Facilitator', value: (r) => r.trainer_name }, { label: 'Cohort', value: (r) => r.cohort_name }, { label: 'Sessions scheduled', value: (r) => r.sessions_scheduled },
    { label: 'Completed', value: (r) => r.sessions_completed }, { label: 'Cancelled', value: (r) => r.sessions_cancelled }, { label: 'Reports filed', value: (r) => r.reports_filed },
    { label: 'Learners', value: (r) => r.learners }, { label: 'Average attendance %', value: (r) => r.avg_attendance }, { label: 'Awaiting grading', value: (r) => r.awaiting_grading },
    { label: 'Graded (timed)', value: (r) => r.graded_with_time }, { label: 'Average turnaround hours', value: (r) => r.avg_turnaround_hours }, { label: 'Feedback notes', value: (r) => r.feedback_notes },
  ]));
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm font-medium">Facilitator<select className={field} value={who} onChange={(e) => setWho(e.target.value)}><option value="">All</option>{people.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
        <Button variant="quiet" onClick={csv}>Download CSV</Button>
      </div>
      {rows.length === 0 ? <EmptyState title="No facilitators">No facilitator is assigned to these cohorts.</EmptyState> : (
        <Table caption="Facilitator report" head={['Facilitator', 'Cohort', 'Sessions', 'Reports', 'Learners', 'Attendance', 'Grading', 'Feedback notes']}>
          {rows.map((r) => (
            <tr key={`${r.trainer_id}-${r.cohort_id}`} className="border-b border-purple-100 align-top">
              <th scope="row" className="p-2 font-medium">{r.trainer_name}</th>
              <td className="p-2">{r.cohort_name}</td>
              <td className="p-2">{r.sessions_completed} of {r.sessions_scheduled} completed{r.sessions_cancelled ? <span className="block text-xs text-ink/60">{r.sessions_cancelled} cancelled</span> : null}</td>
              <td className="p-2">{r.reports_filed}</td>
              <td className="p-2">{r.learners}</td>
              <td className="p-2">{pct(r.avg_attendance)}</td>
              <td className="p-2">{r.awaiting_grading} waiting<span className="block text-xs text-ink/60">turnaround {hoursText(r.avg_turnaround_hours)} ({r.graded_with_time} timed)</span></td>
              <td className="p-2">{r.feedback_notes}</td>
            </tr>
          ))}
        </Table>
      )}
      <p className="text-xs text-ink/60">Grading turnaround is measured only for work graded after Phase 7 was installed. These figures describe workload, not the quality of teaching.</p>
    </div>
  );
}

function LearnersTab({ ids }: { ids: Set<string> }) {
  const q = useRpc<LearnerRow>('ci_learners');
  const [search, setSearch] = useState(''); const [supportOnly, setSupportOnly] = useState(false); const [status, setStatus] = useState<CompletionStatus | 'all'>('all');
  const rows = (q.data ?? []).filter((r) => ids.has(r.cohort_id) && (!supportOnly || r.needs_support) && (status === 'all' || r.completion_status === status)
    && (!search.trim() || `${r.display_name} ${r.participant_no}`.toLowerCase().includes(search.trim().toLowerCase())));
  if (q.isLoading) return <p role="status">Loading…</p>;
  if (q.isError) return <p role="alert" className="text-danger">Could not load learners.</p>;
  const csv = () => downloadCsv('learners', tableCsv(rows, [
    { label: 'Cohort', value: (r) => r.cohort_name }, { label: 'Participant no', value: (r) => r.participant_no }, { label: 'Name', value: (r) => r.display_name },
    { label: 'Track', value: (r) => r.track_name }, { label: 'Learning access', value: (r) => r.access_status }, { label: 'Attendance %', value: (r) => r.attendance_rate },
    { label: 'Submitted', value: (r) => r.submitted }, { label: 'Expected', value: (r) => r.assignments_expected }, { label: 'Overdue', value: (r) => r.overdue },
    { label: 'Overall % (draft)', value: (r) => r.overall }, { label: 'Completion', value: (r) => STATUS_LABEL[r.completion_status] },
    { label: 'May need support', value: (r) => (r.support_reasons ?? []).map((x) => REASON_LABEL[x]) },
  ]));
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm font-medium">Search<input className={field} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or number" /></label>
        <label className="grid gap-1 text-sm font-medium">Completion<select className={field} value={status} onChange={(e) => setStatus(e.target.value as CompletionStatus | 'all')}><option value="all">All</option>{(Object.keys(STATUS_LABEL) as CompletionStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></label>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={supportOnly} onChange={(e) => setSupportOnly(e.target.checked)} /> May need support only</label>
        <Button variant="quiet" onClick={csv}>Download CSV ({rows.length})</Button>
      </div>
      {rows.length === 0 ? <EmptyState title="No learners">No learner matches these filters.</EmptyState> : (
        <Table caption="Learners across cohorts" head={['Learner', 'Cohort', 'Attendance', 'Work', 'Overall', 'Completion', 'Support']}>
          {rows.map((r) => (
            <tr key={`${r.cohort_id}-${r.participant_id}`} className={`border-b border-purple-100 align-top ${r.needs_support ? 'bg-orange-50' : ''}`}>
              <th scope="row" className="p-2 font-medium">{r.display_name}<div className="text-xs font-normal text-ink/60">{r.participant_no}{r.track_name ? ` · ${r.track_name}` : ''}</div></th>
              <td className="p-2">{r.cohort_name}</td>
              <td className="p-2">{pct(r.attendance_rate)}</td>
              <td className="p-2">{r.submitted}/{r.assignments_expected}{r.overdue ? <span className="block text-xs text-danger">{r.overdue} overdue</span> : null}</td>
              <td className="p-2">{pct(r.overall)}</td>
              <td className="p-2">{STATUS_LABEL[r.completion_status]}</td>
              <td className="p-2 text-xs">{(r.support_reasons ?? []).map((x) => REASON_LABEL[x]).join(', ') || '–'}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

function SupportTab({ ids, officer }: { ids: Set<string>; officer: boolean }) {
  const q = useRpc<SupportRow>('ci_support');
  const sg = useRpc<SgRow>('ci_safeguarding_summary', officer);
  const rows = (q.data ?? []).filter((r) => ids.has(r.cohort_id));
  if (q.isLoading) return <p role="status">Loading…</p>;
  if (q.isError) return <p role="alert" className="text-danger">Could not load the support report.</p>;
  const csv = () => downloadCsv('support-and-interventions', tableCsv(rows, [
    { label: 'Cohort', value: (r) => r.cohort_name }, { label: 'Learners', value: (r) => r.learners }, { label: 'May need support', value: (r) => r.needs_support },
    { label: 'Low attendance', value: (r) => r.low_attendance }, { label: 'Overdue work', value: (r) => r.with_overdue_work }, { label: 'Work returned', value: (r) => r.with_returned_work },
    { label: 'Access scheduled', value: (r) => r.access_scheduled }, { label: 'Access expired', value: (r) => r.access_expired }, { label: 'Access suspended', value: (r) => r.access_suspended },
    { label: 'Reports open', value: (r) => r.reports_open }, { label: 'Reports with safeguarding', value: (r) => r.reports_escalated }, { label: 'Reports closed', value: (r) => r.reports_closed },
    { label: 'Active mutes', value: (r) => r.active_mutes }, { label: 'Support messages from closed-access learners (30 days)', value: (r) => r.closed_access_support_messages_30d },
    { label: 'Feedback notes', value: (r) => r.feedback_notes },
  ]));
  return (
    <div className="grid gap-4">
      <Button variant="quiet" className="justify-self-start" onClick={csv}>Download CSV</Button>
      {rows.length === 0 ? <EmptyState title="No cohorts">No cohort matches these filters.</EmptyState> : (
        <Table caption="Support and interventions by cohort" head={['Cohort', 'May need support', 'Learning access', 'DIRA Connect reports', 'Mutes', 'Closed-access support', 'Feedback']}>
          {rows.map((r) => (
            <tr key={r.cohort_id} className="border-b border-purple-100 align-top">
              <th scope="row" className="p-2 font-medium">{r.cohort_name}<div className="text-xs font-normal text-ink/60">{r.learners} learners</div></th>
              <td className="p-2">{r.needs_support}<span className="block text-xs text-ink/60">attendance {r.low_attendance} · overdue {r.with_overdue_work} · returned {r.with_returned_work}</span></td>
              <td className="p-2 text-xs">scheduled {r.access_scheduled} · expired {r.access_expired} · suspended {r.access_suspended}</td>
              <td className="p-2 text-xs">open {r.reports_open} · with safeguarding {r.reports_escalated} · closed {r.reports_closed}</td>
              <td className="p-2">{r.active_mutes}</td>
              <td className="p-2">{r.closed_access_support_messages_30d} <span className="text-xs text-ink/60">messages, 30 days</span></td>
              <td className="p-2">{r.feedback_notes}</td>
            </tr>
          ))}
        </Table>
      )}
      {officer && (
        <section aria-labelledby="sg-totals" className="grid gap-2 rounded-card border border-amber-300 bg-amber-50 p-3 text-sm">
          <h2 id="sg-totals" className="font-semibold">Safeguarding totals (visible only to the Safeguarding Lead and Deputy)</h2>
          {(sg.data ?? []).length === 0 ? <p>No safeguarding records.</p> : (
            <ul>{(sg.data ?? []).map((r) => <li key={r.cohort_name}><strong>{r.cohort_name}:</strong> {r.open_count} open, {r.acknowledged_or_active} in hand, {r.resolved_or_closed} resolved or closed, {r.urgent} urgent{r.overdue_ack ? `, ${r.overdue_ack} past the acknowledgement target` : ''}{r.legal_holds ? `, ${r.legal_holds} on legal hold` : ''}</li>)}</ul>
          )}
          <p className="text-xs">Totals only. Open Safeguarding for the records themselves. Small numbers can identify people: do not share these figures outside the safeguarding team.</p>
        </section>
      )}
    </div>
  );
}
