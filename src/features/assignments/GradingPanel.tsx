import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { expectedRoster } from '@/features/sessions/rules';
import type { Assignment, Submission } from '@/types/database';
import { assignmentProgress, latestAttempt, percentOf, validateGrade, type GradeAction, type LearnerState } from './rules';
import { AttemptCard, StateBadge } from './shared';

interface EnrolRow { participant_id: string; track_id: string | null; participants: { participant_no: string; profiles: { first_name: string; last_name: string } | null } | null }
const field = 'rounded-control border border-purple-200 px-3 py-2 font-normal';

export function GradingPanel({ a }: { a: Assignment }) {
  const [selected, setSelected] = useState<string | null>(null);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['grading', a.id],
    queryFn: async () => {
      const [e, s] = await Promise.all([
        supabase.from('cohort_enrolments').select('participant_id, track_id, participants(participant_no, profiles(first_name, last_name))').eq('cohort_id', a.cohort_id),
        supabase.from('submissions').select('*').eq('assignment_id', a.id).order('attempt', { ascending: true }),
      ]);
      if (e.error) throw e.error;
      if (s.error) throw s.error;
      return { enrols: e.data as unknown as EnrolRow[], subs: s.data as Submission[] };
    },
  });
  if (q.isLoading) return <p role="status">Loading submissions…</p>;
  if (q.isError) return <p role="alert" className="text-danger">Could not load submissions.</p>;

  const roster = expectedRoster(q.data!.enrols.map((e) => ({ ...e, participantId: e.participant_id, trackId: e.track_id })), a.track_id);
  if (!roster.length) return <EmptyState title="No participants yet">Nobody is enrolled for this assignment.</EmptyState>;
  const subs = q.data!.subs;
  const byPerson = (pid: string) => subs.filter((s) => s.participant_id === pid);
  const progress = assignmentProgress(roster.map((r) => r.participantId), subs.map((s) => ({ participantId: s.participant_id, attempt: s.attempt, status: s.status })));
  const pick = roster.find((r) => r.participantId === selected) ?? null;
  const pickSubs = pick ? byPerson(pick.participantId) : [];
  const pickLatest = latestAttempt(pickSubs);

  return (
    <div className="grid gap-6">
      <p className="text-sm" role="status">
        {progress.expected} expected · <strong>{progress.toGrade} to grade</strong> · {progress.returned} returned · {progress.graded} graded · {progress.notSubmitted} not submitted
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead><tr className="border-b border-purple-100 text-ink/70"><th className="py-2 pr-3">Participant</th><th className="pr-3">Status</th><th className="pr-3">Score</th><th /></tr></thead>
          <tbody>
            {roster.map((r) => {
              const last = latestAttempt(byPerson(r.participantId));
              const pct = last ? percentOf(last.score, a.max_score) : null;
              const state: LearnerState | null = last ? last.status : null;
              return (
                <tr key={r.participantId} className="border-b border-purple-50">
                  <td className="py-2 pr-3">{r.participants?.profiles?.first_name} {r.participants?.profiles?.last_name} <span className="text-ink/60">({r.participants?.participant_no})</span></td>
                  <td className="pr-3">{state ? <StateBadge state={state} /> : <span className="text-ink/60">Not submitted</span>}</td>
                  <td className="pr-3">{last?.status === 'graded' && last.score !== null ? `${last.score} / ${a.max_score}${pct !== null ? ` (${pct}%)` : ''}` : '–'}</td>
                  <td>{last && <Button variant="quiet" onClick={() => setSelected(r.participantId)}>{last.status === 'submitted' || last.status === 'late' ? 'Grade' : 'View'}</Button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pick && pickLatest && (
        <div className="grid gap-3 rounded-card border border-purple-100 p-5">
          <h2 className="font-display text-xl font-semibold text-purple-900">{pick.participants?.profiles?.first_name} {pick.participants?.profiles?.last_name}</h2>
          {pickSubs.map((s) => <AttemptCard key={s.id} s={s} maxScore={a.max_score} />)}
          <GradeForm key={`${pickLatest.id}-${pickLatest.status}`} a={a} latest={pickLatest}
            onDone={() => { void qc.invalidateQueries({ queryKey: ['grading', a.id] }); void qc.invalidateQueries({ queryKey: ['staff-assignments'] }); }} />
        </div>
      )}
    </div>
  );
}

function GradeForm({ a, latest, onDone }: { a: Assignment; latest: Submission; onDone: () => void }) {
  const [score, setScore] = useState(latest.score?.toString() ?? '');
  const [feedback, setFeedback] = useState(latest.feedback ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async (action: GradeAction) => {
      const err = validateGrade({ action, score, maxScore: a.max_score, feedback, allowResubmission: a.allow_resubmission });
      if (err) throw new Error(err);
      const { data, error } = await supabase.from('submissions').update({
        status: action === 'grade' ? 'graded' : 'returned',
        score: action === 'grade' && a.max_score !== null ? Number(score) : null,
        feedback: feedback.trim() || null,
      }).eq('id', latest.id).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Could not save. You may not have permission for this participant.');
    },
    onSuccess: () => { setMsg('Saved.'); onDone(); },
    onError: (e: Error) => setMsg(e.message),
  });
  return (
    <div className="grid gap-3 border-t border-purple-100 pt-4">
      <h3 className="text-sm font-semibold text-ink/70">Grade attempt {latest.attempt}</h3>
      {a.max_score !== null && (
        <label className="grid w-40 gap-1 text-sm font-medium">Score (out of {a.max_score})
          <input type="number" inputMode="decimal" min={0} max={a.max_score} step="any" value={score} onChange={(e) => setScore(e.target.value)} className={field} />
        </label>
      )}
      <label className="grid gap-1 text-sm font-medium">Feedback for the participant
        <textarea rows={4} value={feedback} onChange={(e) => setFeedback(e.target.value)} className={field} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button disabled={save.isPending} onClick={() => { setMsg(null); save.mutate('grade'); }}>Save grade</Button>
        {a.allow_resubmission && <Button variant="quiet" disabled={save.isPending} onClick={() => { setMsg(null); save.mutate('return'); }}>Return for revision</Button>}
      </div>
      {msg && <p role="status" className="text-sm">{msg}</p>}
    </div>
  );
}
