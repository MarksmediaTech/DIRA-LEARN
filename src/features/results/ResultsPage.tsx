import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { EmptyState } from '@/components/ui/EmptyState';
import type { AttendanceStatus, SubmissionStatus } from '@/types/database';
import { isAssignedTo, recipientMap } from '@/features/assignments/rules';
import { COMPONENT_LABEL, completionChecks, fmtPercent, summariseResult, type AssessmentComponent } from './rules';

interface EnrolRow { participant_id: string; track_id: string | null; participants: { participant_no: string; profiles: { first_name: string; last_name: string } | null } | null }
interface ScheduleRow { id: string; curriculum_session_id: string; status: string; curriculum_sessions: { track_id: string | null } | null }
interface AttRow { schedule_id: string; participant_id: string; status: AttendanceStatus }
interface AssignRow { id: string; track_id: string | null; component: AssessmentComponent; max_score: number | null }
interface SubRow { assignment_id: string; participant_id: string; attempt: number; status: SubmissionStatus; score: number | null }

export function ResultsPage() {
  const { profile } = useAuth();
  const isParticipant = profile?.role === 'participant';
  const [cohortId, setCohortId] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const cohorts = useQuery({
    queryKey: ['results-cohorts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cohorts').select('id, name').order('start_date', { ascending: false });
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
  });
  useEffect(() => {
    const first = cohorts.data?.[0];
    if (!cohortId && first) setCohortId(first.id);
  }, [cohorts.data, cohortId]);

  const data = useQuery({
    queryKey: ['results-data', cohortId],
    enabled: Boolean(cohortId),
    queryFn: async () => {
      const [e, s, a] = await Promise.all([
        supabase.from('cohort_enrolments').select('participant_id, track_id, participants(participant_no, profiles(first_name, last_name))').eq('cohort_id', cohortId),
        supabase.from('session_schedules').select('id, curriculum_session_id, status, curriculum_sessions(track_id)').eq('cohort_id', cohortId),
        supabase.from('assignments').select('id, track_id, component, max_score').eq('cohort_id', cohortId),
      ]);
      if (e.error) throw e.error;
      if (s.error) throw s.error;
      if (a.error) throw a.error;
      const scheduleIds = (s.data ?? []).map((x) => x.id);
      const assignmentIds = (a.data ?? []).map((x) => x.id);
      const [att, sub, rec] = await Promise.all([
        scheduleIds.length ? supabase.from('attendance').select('schedule_id, participant_id, status').in('schedule_id', scheduleIds) : Promise.resolve({ data: [], error: null }),
        assignmentIds.length ? supabase.from('submissions').select('assignment_id, participant_id, attempt, status, score').in('assignment_id', assignmentIds) : Promise.resolve({ data: [], error: null }),
        assignmentIds.length ? supabase.from('assignment_recipients').select('assignment_id, participant_id').in('assignment_id', assignmentIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if (att.error) throw att.error;
      if (sub.error) throw sub.error;
      if (rec.error) throw rec.error;
      return {
        enrols: e.data as unknown as EnrolRow[], schedules: s.data as unknown as ScheduleRow[], assignments: a.data as unknown as AssignRow[],
        attendance: att.data as AttRow[], submissions: sub.data as SubRow[],
        recipients: recipientMap((rec.data ?? []) as { assignment_id: string; participant_id: string }[]),
      };
    },
  });

  const rows = useMemo(() => {
    const d = data.data;
    if (!d) return [];
    const coreCount = new Set(d.schedules.filter((x) => x.curriculum_sessions?.track_id == null).map((x) => x.curriculum_session_id)).size;
    return d.enrols.map((en) => {
      const mySchedules = d.schedules.filter((x) => x.status !== 'cancelled' && (x.curriculum_sessions?.track_id == null || x.curriculum_sessions.track_id === en.track_id));
      const scheduleById = new Map<string, ScheduleRow>(mySchedules.map((x): [string, ScheduleRow] => [x.id, x]));
      const myAtt = d.attendance.filter((x) => x.participant_id === en.participant_id && scheduleById.has(x.schedule_id));
      const myAssignments = d.assignments.filter((x) => (x.track_id === null || x.track_id === en.track_id) && isAssignedTo(x.id, en.participant_id, d.recipients));
      const mySubs = d.submissions.filter((x) => x.participant_id === en.participant_id);
      const result = summariseResult({
        attendance: myAtt.map((x) => x.status),
        assignments: myAssignments.map((x) => ({ id: x.id, component: x.component, maxScore: x.max_score })),
        submissions: mySubs.map((x) => ({ assignmentId: x.assignment_id, attempt: x.attempt, status: x.status, score: x.score })),
      });
      const submitted = (c: AssessmentComponent) => myAssignments.filter((x) => x.component === c).some((x) => mySubs.some((s) => s.assignment_id === x.id));
      const completion = completionChecks({
        sessions: myAtt.map((x) => ({ curriculumSessionId: scheduleById.get(x.schedule_id)!.curriculum_session_id, isCore: scheduleById.get(x.schedule_id)!.curriculum_sessions?.track_id == null, status: x.status })),
        coreSessionCount: coreCount, finalProjectSubmitted: submitted('final_project'), reflectionSubmitted: submitted('reflection'),
      });
      const name = en.participants?.profiles ? `${en.participants.profiles.first_name} ${en.participants.profiles.last_name}` : 'Participant';
      return { id: en.participant_id, no: en.participants?.participant_no ?? '', name, result, completion };
    }).sort((x, y) => x.name.localeCompare(y.name));
  }, [data.data]);

  if (cohorts.isLoading) return <p role="status">Loading…</p>;
  if (cohorts.isError) return <p role="alert" className="text-danger">Could not load your cohort.</p>;
  if (!cohorts.data?.length) return <EmptyState title="No cohort yet">Results appear here once you are enrolled in a cohort.</EmptyState>;

  return (
    <section className="grid max-w-5xl gap-5">
      <h1 className="text-2xl font-bold text-purple-700">{isParticipant ? 'My results' : 'Results'}</h1>
      <p className="rounded-card border border-amber-300 bg-amber-50 p-3 text-sm">
        <strong>Provisional.</strong> The weights (attendance 20%, tasks 30%, final project 40%, reflection 10%) and the completion rules are recommendations awaiting management approval. No pass mark has been set, so none is applied.
      </p>
      {!isParticipant && cohorts.data.length > 1 && (
        <label className="grid max-w-xs gap-1 text-sm font-medium">Cohort
          <select value={cohortId} onChange={(e) => { setCohortId(e.target.value); setOpenId(null); }} className="rounded-control border border-purple-200 px-3 py-2 font-normal">
            {cohorts.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}
      {data.isLoading && <p role="status">Loading results…</p>}
      {data.isError && <p role="alert" className="text-danger">Could not load results.</p>}
      {data.data && !rows.length && <EmptyState title="No participants">No one is enrolled in this cohort yet.</EmptyState>}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Results by participant</caption>
            <thead><tr className="border-b border-purple-200">
              <th scope="col" className="p-2">Participant</th><th scope="col" className="p-2">Attendance</th><th scope="col" className="p-2">Tasks</th>
              <th scope="col" className="p-2">Final project</th><th scope="col" className="p-2">Reflection</th><th scope="col" className="p-2">Overall</th><th scope="col" className="p-2">Completion</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-purple-100 align-top">
                  <th scope="row" className="p-2 font-medium">
                    <button type="button" aria-expanded={openId === r.id} onClick={() => setOpenId(openId === r.id ? null : r.id)} className="text-left text-purple-700 underline">{r.name}</button>
                    <div className="text-xs font-normal text-ink/60">{r.no}</div>
                    {openId === r.id && <Detail row={r} />}
                  </th>
                  <td className="p-2">{fmtPercent(r.result.engagement)}</td>
                  <td className="p-2">{fmtPercent(r.result.tasks.percent)}{r.result.tasks.partial && r.result.tasks.percent !== null ? '*' : ''}</td>
                  <td className="p-2">{fmtPercent(r.result.finalProject.percent)}</td>
                  <td className="p-2">{fmtPercent(r.result.reflection.percent)}</td>
                  <td className="p-2 font-semibold">{fmtPercent(r.result.overall)}{r.result.provisional ? '*' : ''}</td>
                  <td className="p-2">{r.completion.allMet ? 'Requirements met' : `${r.completion.checks.filter((c) => c.ok).length} of ${r.completion.checks.length} met`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-ink/60">– means nothing is graded or recorded yet (not zero). * means some scored work is still ungraded, so the figure may change.</p>
        </div>
      )}
    </section>
  );
}

function Detail({ row }: { row: { result: ReturnType<typeof summariseResult>; completion: ReturnType<typeof completionChecks> } }) {
  const c = row.completion;
  return (
    <div className="mt-2 grid gap-2 rounded-card bg-purple-50 p-3 text-sm font-normal">
      {row.result.missing.length > 0 && (
        <div><p className="font-semibold">Why there is no overall yet</p><ul className="list-disc pl-5">{row.result.missing.map((m) => <li key={m}>{m}</li>)}</ul></div>
      )}
      <div>
        <p className="font-semibold">Graded work</p>
        <ul className="list-disc pl-5">
          <li>{COMPONENT_LABEL.task}s: {row.result.tasks.graded} of {row.result.tasks.total} graded</li>
          <li>{COMPONENT_LABEL.final_project}: {row.result.finalProject.graded} of {row.result.finalProject.total} graded</li>
          <li>{COMPONENT_LABEL.reflection}: {row.result.reflection.graded} of {row.result.reflection.total} graded</li>
        </ul>
      </div>
      <div>
        <p className="font-semibold">Completion requirements (draft)</p>
        <ul>{c.checks.map((k) => <li key={k.key}><span aria-hidden>{k.ok ? '✓' : '○'}</span> <span className="sr-only">{k.ok ? 'Met: ' : 'Not yet met: '}</span>{k.label}</li>)}</ul>
      </div>
    </div>
  );
}
