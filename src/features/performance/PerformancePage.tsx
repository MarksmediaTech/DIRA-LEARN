import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useProgrammeTimezone } from '@/features/cohorts/useProgrammeTimezone';
import { formatInZone } from '@/lib/timezone';
import {
  EMPTY_FILTER, REASON_LABEL, STATUS_LABEL, applyFilter, canExport, canGiveFeedback, canSeeCohortTable, pct, sortRows, toCsv, trend, validateFeedback,
  type CompletionStatus, type Filter, type LearnerMetrics, type Snapshot,
} from './rules';

// Phase 6 (migration 27). Every figure comes from learner_metrics() in the database, which also decides who sees whom.
const field = 'rounded-control border border-purple-200 px-3 py-2 font-normal';
interface Feedback { id: string; body: string; shared_with_learner: boolean; created_at: string; author_id: string }
interface CohortOption { id: string; name: string }

export function PerformancePage() {
  const { profile } = useAuth();
  if (profile?.role === 'participant') return <MyPerformance />;
  if (canSeeCohortTable(profile?.role)) return <CohortPerformance role={profile?.role ?? ''} />;
  return <EmptyState title="Not available">Performance records are shown to learners, their facilitators, mentors and programme staff.</EmptyState>;
}

function DraftNotice() {
  return (
    <p className="rounded-card border border-amber-300 bg-amber-50 p-3 text-sm">
      <strong>Provisional.</strong> The weights (attendance 20%, tasks 30%, final project 40%, reflection 10%), the completion requirements and the
      &quot;may need support&quot; thresholds are drafts awaiting management approval. No pass mark is applied. – means nothing is recorded yet (not zero).
    </p>
  );
}

function MyPerformance() {
  const mine = useQuery({
    queryKey: ['my-performance'],
    queryFn: async () => { const { data, error } = await supabase.rpc('my_performance'); if (error) throw error; return (data ?? []) as { cohort_id: string; cohort_name: string; metrics: LearnerMetrics }[]; },
  });
  return (
    <section className="grid max-w-4xl gap-5">
      <h1 className="text-2xl font-bold text-purple-700">My performance</h1>
      <DraftNotice />
      {mine.isLoading && <p role="status">Loading…</p>}
      {mine.isError && <p role="alert" className="text-danger">Could not load your performance.</p>}
      {mine.data && mine.data.length === 0 && <EmptyState title="Nothing to show yet">Your performance appears here once your learning access is open.</EmptyState>}
      {(mine.data ?? []).map((c) => (
        <article key={c.cohort_id} className="grid gap-4 rounded-card border border-purple-100 p-4">
          <h2 className="font-display text-lg font-semibold">{c.cohort_name}</h2>
          <Summary m={c.metrics} />
          <FeedbackList participantId={c.metrics.participant_id} cohortId={c.cohort_id} canWrite={false} />
          <History participantId={c.metrics.participant_id} cohortId={c.cohort_id} />
        </article>
      ))}
    </section>
  );
}

function CohortPerformance({ role }: { role: string }) {
  const [cohortId, setCohortId] = useState('');
  const [filter, setFilter] = useState<Filter>(EMPTY_FILTER);
  const [openId, setOpenId] = useState<string | null>(null);
  const cohorts = useQuery({
    queryKey: ['performance-cohorts'],
    queryFn: async () => { const { data, error } = await supabase.rpc('performance_cohorts'); if (error) throw error; return (data ?? []) as CohortOption[]; },
  });
  useEffect(() => { const first = cohorts.data?.[0]; if (!cohortId && first) setCohortId(first.id); }, [cohorts.data, cohortId]);
  const metrics = useQuery({
    queryKey: ['learner-metrics', cohortId], enabled: Boolean(cohortId),
    queryFn: async () => { const { data, error } = await supabase.rpc('learner_metrics', { p_cohort: cohortId }); if (error) throw error; return (data ?? []) as LearnerMetrics[]; },
  });
  const rows = useMemo(() => sortRows(applyFilter(metrics.data ?? [], filter)), [metrics.data, filter]);
  const tracks = useMemo(() => [...new Map((metrics.data ?? []).filter((r) => r.track_id).map((r) => [r.track_id ?? '', r.track_name ?? ''])).entries()], [metrics.data]);
  const supportCount = (metrics.data ?? []).filter((r) => r.needs_support).length;
  const cohortName = cohorts.data?.find((c) => c.id === cohortId)?.name ?? 'cohort';
  const opened = openId ? rows.find((r) => r.participant_id === openId) ?? null : null;

  const download = () => {
    const blob = new Blob([`\uFEFF${toCsv(rows)}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `performance-${cohortName.replace(/[^A-Za-z0-9]+/g, '-')}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section className="grid max-w-6xl gap-5">
      <h1 className="text-2xl font-bold text-purple-700">Learner performance</h1>
      <DraftNotice />
      {cohorts.isLoading && <p role="status">Loading…</p>}
      {cohorts.data && cohorts.data.length === 0 && <EmptyState title="No cohorts">You have no cohorts to review.</EmptyState>}
      {cohorts.data && cohorts.data.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="grid gap-1 text-sm font-medium">Cohort
            <select className={field} value={cohortId} onChange={(e) => { setCohortId(e.target.value); setOpenId(null); }}>{cohorts.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </label>
          <label className="grid gap-1 text-sm font-medium">Search<input className={field} value={filter.search} onChange={(e) => setFilter({ ...filter, search: e.target.value })} placeholder="Name or number" /></label>
          <label className="grid gap-1 text-sm font-medium">Track
            <select className={field} value={filter.trackId} onChange={(e) => setFilter({ ...filter, trackId: e.target.value })}><option value="all">All tracks</option>{tracks.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
          </label>
          <label className="grid gap-1 text-sm font-medium">Completion
            <select className={field} value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value as CompletionStatus | 'all' })}>
              <option value="all">All</option>{(Object.keys(STATUS_LABEL) as CompletionStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </label>
          <label className="flex items-end gap-2 pb-2 text-sm font-medium"><input type="checkbox" checked={filter.supportOnly} onChange={(e) => setFilter({ ...filter, supportOnly: e.target.checked })} /> May need support only ({supportCount})</label>
        </div>
      )}
      {metrics.isLoading && <p role="status">Loading learners…</p>}
      {metrics.isError && <p role="alert" className="text-danger">Could not load learner performance.</p>}
      {metrics.data && rows.length === 0 && <EmptyState title="No learners">No learner matches these filters.</EmptyState>}
      {rows.length > 0 && (
        <>
          {canExport(role) && <Button variant="quiet" className="justify-self-start" onClick={download}>Download CSV ({rows.length} learners)</Button>}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <caption className="sr-only">Learner performance for {cohortName}</caption>
              <thead><tr className="border-b border-purple-200">
                <th scope="col" className="p-2">Learner</th><th scope="col" className="p-2">Attendance</th><th scope="col" className="p-2">Sessions</th>
                <th scope="col" className="p-2">Work</th><th scope="col" className="p-2">Overall</th><th scope="col" className="p-2">Completion</th><th scope="col" className="p-2">Support</th>
              </tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.participant_id} className={`border-b border-purple-100 align-top ${r.needs_support ? 'bg-orange-50' : ''}`}>
                    <th scope="row" className="p-2 font-medium">
                      <button type="button" className="text-left text-purple-700 underline" aria-expanded={openId === r.participant_id} onClick={() => setOpenId(openId === r.participant_id ? null : r.participant_id)}>{r.display_name}</button>
                      <div className="text-xs font-normal text-ink/60">{r.participant_no}{r.track_name ? ` · ${r.track_name}` : ''}{r.access_status !== 'active' ? ` · access ${r.access_status}` : ''}</div>
                    </th>
                    <td className="p-2">{pct(r.attendance_rate)}</td>
                    <td className="p-2">{r.sessions_attended} <span className="text-xs text-ink/60">(core {r.core_attended}/{r.core_total})</span></td>
                    <td className="p-2">{r.submitted}/{r.assignments_expected} submitted{r.overdue ? <span className="block text-xs text-danger">{r.overdue} overdue</span> : null}</td>
                    <td className="p-2 font-semibold">{pct(r.overall)}{r.provisional ? '*' : ''}</td>
                    <td className="p-2">{STATUS_LABEL[r.completion_status]}</td>
                    <td className="p-2 text-xs">{(r.support_reasons ?? []).map((x) => REASON_LABEL[x]).join(', ') || '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-ink/60">* some scored work is still ungraded, so the figure may change.</p>
          </div>
          {opened && (
            <article className="grid gap-4 rounded-card border border-purple-200 p-4" aria-label={`Details for ${opened.display_name}`}>
              <div className="flex items-center justify-between gap-2"><h2 className="font-display text-lg font-semibold">{opened.display_name}</h2><Button variant="quiet" onClick={() => setOpenId(null)}>Close</Button></div>
              <Summary m={opened} />
              <FeedbackList participantId={opened.participant_id} cohortId={cohortId} canWrite={canGiveFeedback(role)} />
              <History participantId={opened.participant_id} cohortId={cohortId} />
            </article>
          )}
        </>
      )}
    </section>
  );
}

function Summary({ m }: { m: LearnerMetrics }) {
  const items: [string, string][] = [
    ['Attendance', pct(m.attendance_rate)], ['Sessions attended', `${m.sessions_attended} (core ${m.core_attended} of ${m.core_total})`],
    ['Work submitted', `${m.submitted} of ${m.assignments_expected}`], ['Graded', String(m.graded)],
    ['Session tasks', `${pct(m.tasks_pct)} (${m.tasks_graded} of ${m.tasks_total} graded)`], ['Final project', pct(m.final_pct)],
    ['Reflection', pct(m.reflection_pct)], ['Overall (draft)', `${pct(m.overall)}${m.provisional ? ' (provisional)' : ''}`],
  ];
  const checks: [string, boolean][] = [
    [`At least 6 sessions (${m.sessions_attended})`, m.sessions_attended >= 6], [`Both core sessions (${m.core_attended} of ${m.core_total})`, m.core_total > 0 && m.core_attended >= m.core_total],
    ['Final project submitted', m.final_submitted], ['Reflection submitted', m.reflection_submitted],
  ];
  return (
    <div className="grid gap-3">
      <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
        {items.map(([k, v]) => <div key={k} className="rounded-card bg-purple-50 p-2"><dt className="text-xs text-ink/60">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
      </dl>
      <div className="text-sm">
        <p className="font-semibold">Completion: {STATUS_LABEL[m.completion_status]}</p>
        <ul>{checks.map(([label, ok]) => <li key={label}><span aria-hidden>{ok ? '✓' : '○'}</span> <span className="sr-only">{ok ? 'Met: ' : 'Not yet met: '}</span>{label}</li>)}</ul>
        {m.overdue > 0 && <p className="text-danger">{m.overdue} piece(s) of work overdue.</p>}
        {m.returned > 0 && <p>{m.returned} piece(s) returned for revision.</p>}
      </div>
    </div>
  );
}

function FeedbackList({ participantId, cohortId, canWrite }: { participantId: string; cohortId: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const { tz } = useProgrammeTimezone();
  const [body, setBody] = useState(''); const [shared, setShared] = useState(true); const [error, setError] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['learner-feedback', participantId, cohortId],
    queryFn: async () => {
      const { data, error: e } = await supabase.from('learner_feedback').select('id, body, shared_with_learner, created_at, author_id').eq('participant_id', participantId).eq('cohort_id', cohortId).order('created_at', { ascending: false });
      if (e) throw e; return (data ?? []) as Feedback[];
    },
  });
  const add = useMutation({
    mutationFn: async () => {
      const bad = validateFeedback(body); if (bad) throw new Error(bad);
      const { data: auth } = await supabase.auth.getUser();
      const { error: e } = await supabase.from('learner_feedback').insert({ participant_id: participantId, cohort_id: cohortId, author_id: auth.user?.id, body: body.trim(), shared_with_learner: shared });
      if (e) throw e;
    },
    onSuccess: () => { setBody(''); setError(null); void qc.invalidateQueries({ queryKey: ['learner-feedback', participantId, cohortId] }); },
    onError: (e) => setError(e.message),
  });
  return (
    <div className="grid gap-2 text-sm">
      <h3 className="font-semibold">Feedback on progress</h3>
      {list.data && list.data.length === 0 && <p className="text-ink/70">No feedback yet.</p>}
      <ul className="grid gap-2">{(list.data ?? []).map((f) => (
        <li key={f.id} className="rounded-card border border-purple-100 p-2">
          <p className="whitespace-pre-wrap">{f.body}</p>
          <p className="mt-1 text-xs text-ink/60">{formatInZone(f.created_at, tz)}{f.shared_with_learner ? '' : ' · staff only'}</p>
        </li>))}</ul>
      {canWrite && (
        <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
          <label className="grid gap-1 font-medium">Add feedback<textarea className={field} rows={3} maxLength={2000} value={body} onChange={(e) => setBody(e.target.value)} /></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Share with the learner (they are notified). Untick for a staff-only note.</label>
          {error && <p role="alert" className="text-danger">{error}</p>}
          <Button type="submit" disabled={add.isPending} className="justify-self-start">Save feedback</Button>
          <p className="text-xs text-ink/60">Feedback cannot be edited or deleted later. Add a new note to correct it.</p>
        </form>
      )}
    </div>
  );
}

function History({ participantId, cohortId }: { participantId: string; cohortId: string }) {
  const h = useQuery({
    queryKey: ['performance-history', participantId, cohortId],
    queryFn: async () => { const { data, error } = await supabase.rpc('learner_performance_history', { p_participant: participantId, p_cohort: cohortId }); if (error) throw error; return (data ?? []) as Snapshot[]; },
  });
  const rows = h.data ?? [];
  const o = trend(rows, 'overall'); const a = trend(rows, 'attendance_rate');
  const sign = (n: number) => (n > 0 ? `+${n}` : String(n));
  return (
    <div className="grid gap-2 text-sm">
      <h3 className="font-semibold">History</h3>
      {rows.length === 0 && <p className="text-ink/70">No history yet. A snapshot is taken once a day while the cohort runs.</p>}
      {(o !== null || a !== null) && <p>Since the first snapshot: overall {o === null ? '–' : `${sign(o)} points`}, attendance {a === null ? '–' : `${sign(a)} points`}.</p>}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead><tr className="border-b border-purple-200"><th className="p-1">Date</th><th className="p-1">Attendance</th><th className="p-1">Submitted</th><th className="p-1">Graded</th><th className="p-1">Overdue</th><th className="p-1">Overall</th></tr></thead>
            <tbody>{rows.slice(-14).map((s) => <tr key={s.taken_on} className="border-b border-purple-50"><td className="p-1">{s.taken_on}</td><td className="p-1">{pct(s.attendance_rate)}</td><td className="p-1">{s.submitted}</td><td className="p-1">{s.graded}</td><td className="p-1">{s.overdue}</td><td className="p-1">{pct(s.overall)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
