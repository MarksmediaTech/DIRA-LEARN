import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import type { Assignment } from '@/types/database';
import { COMPONENT_LABEL } from '@/features/results/rules';
import { GROUP_LABEL, GROUP_ORDER, assignmentProgress, eligibleParticipants, groupAssignments, recipientMap, validateAssignment, type AttemptLike } from './rules';
import { useMyAssignments } from './useMyAssignments';
import { StateBadge } from './shared';

type Row = Assignment & { cohorts: { name: string } | null; tracks: { name: string } | null };
const COLS = 'id, cohort_id, track_id, title, instructions, due_at, allow_resubmission, max_score, component, created_at, cohorts(name), tracks(name)';
const field = 'rounded-control border border-purple-200 px-3 py-2 font-normal';
const due = (d: string | null | undefined) => (d ? `Due ${new Date(d).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}` : 'No due date');

export function AssignmentsPage() {
  const { profile } = useAuth();
  return (
    <section className="grid max-w-4xl gap-6">
      <h1 className="text-2xl font-bold text-purple-700">{profile?.role === 'participant' ? 'My Assignments' : 'Assignments'}</h1>
      {profile?.role === 'participant' ? <ParticipantList /> : <StaffList />}
    </section>
  );
}

function ParticipantList() {
  const q = useMyAssignments();
  if (q.isLoading) return <p role="status">Loading your assignments…</p>;
  if (q.isError) return <p role="alert" className="text-danger">Could not load your assignments.</p>;
  const items = q.data ?? [];
  if (!items.length) return <EmptyState title="No assignments yet">Your trainer will add assignments as the programme goes on.</EmptyState>;
  const groups = groupAssignments(items);
  return (
    <div className="grid gap-6">
      {GROUP_ORDER.filter((g) => groups[g].length > 0).map((g) => (
        <section key={g} aria-labelledby={`grp-${g}`} className="grid gap-3">
          <h2 id={`grp-${g}`} className="font-display text-xl font-semibold text-purple-900">{GROUP_LABEL[g]} <span className="text-base font-normal text-ink/60">({groups[g].length})</span></h2>
          <ul className="grid gap-3">
            {groups[g].map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-purple-100 p-4">
                <div>
                  <Link to={`/assignments/${a.id}`} className="font-semibold text-purple-700 underline">{a.title}</Link>
                  <p className="text-sm text-ink/70">{due(a.dueAt)}{a.track ? ` · ${a.track}` : ''}</p>
                  {a.submittedAt && <p className="text-sm text-ink/70">Submitted {new Date(a.submittedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}{a.state === 'graded' && a.maxScore !== null && a.score !== null ? ` · Score ${a.score} / ${a.maxScore}` : ''}</p>}
                </div>
                <StateBadge state={a.state} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function StaffList() {
  const [creating, setCreating] = useState(false);
  const q = useQuery({
    queryKey: ['staff-assignments'],
    queryFn: async () => {
      const [a, e, s, rc] = await Promise.all([
        supabase.from('assignments').select(COLS).order('created_at', { ascending: false }),
        supabase.from('cohort_enrolments').select('cohort_id, participant_id, track_id'),
        supabase.from('submissions').select('assignment_id, participant_id, attempt, status'),
        supabase.from('assignment_recipients').select('assignment_id, participant_id'),
      ]);
      if (a.error) throw a.error;
      if (e.error) throw e.error;
      if (s.error) throw s.error;
      if (rc.error) throw rc.error;
      return {
        recipients: recipientMap((rc.data ?? []) as { assignment_id: string; participant_id: string }[]),
        assignments: a.data as unknown as Row[],
        enrols: e.data as { cohort_id: string; participant_id: string; track_id: string | null }[],
        subs: s.data as { assignment_id: string; participant_id: string; attempt: number; status: AttemptLike['status'] }[],
      };
    },
  });
  const data = q.data;  // a local copy keeps TypeScript's "not undefined" check inside the callbacks below
  return (
    <div className="grid gap-4">
      <div><Button onClick={() => setCreating((v) => !v)}>{creating ? 'Close' : 'New assignment'}</Button></div>
      {creating && <CreateForm onDone={() => setCreating(false)} />}
      {q.isLoading && <p role="status">Loading assignments…</p>}
      {q.isError && <p role="alert" className="text-danger">Could not load assignments.</p>}
      {q.data && !q.data.assignments.length && <EmptyState title="No assignments yet">Create one for a cohort to get started.</EmptyState>}
      {data && (
        <ul className="grid gap-3">
          {data.assignments.map((a) => {
            const roster = eligibleParticipants({ id: a.id, trackId: a.track_id }, data.enrols.filter((e) => e.cohort_id === a.cohort_id).map((e) => ({ participantId: e.participant_id, trackId: e.track_id })), data.recipients);
            const chosen = data.recipients.get(a.id)?.size ?? 0;
            const p = assignmentProgress(roster, data.subs.filter((s) => s.assignment_id === a.id).map((s) => ({ participantId: s.participant_id, attempt: s.attempt, status: s.status })));
            return (
              <li key={a.id} className="rounded-card border border-purple-100 p-4">
                <Link to={`/assignments/${a.id}`} className="font-semibold text-purple-700 underline">{a.title}</Link>
                <p className="text-sm text-ink/70">{a.cohorts?.name}{chosen > 0 ? ` · ${chosen} selected learner${chosen === 1 ? '' : 's'}` : a.tracks ? ` · ${a.tracks.name}` : ' · All tracks'} · {due(a.due_at)}{a.max_score !== null ? ` · out of ${a.max_score}` : ' · feedback only'} · {COMPONENT_LABEL[a.component]}</p>
                <p className="mt-1 text-sm"><strong>{p.toGrade} to grade</strong> · {p.graded} graded · {p.returned} returned · {p.notSubmitted} not submitted (of {p.expected})</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<'cohort' | 'selected'>('cohort');
  const [chosen, setChosen] = useState<string[]>([]);
  const [f, setF] = useState({ cohortId: '', trackId: '', title: '', instructions: '', dueAt: '', maxScore: '', resubmit: false, component: 'task' as 'task' | 'final_project' | 'reflection' });
  const [msg, setMsg] = useState<string | null>(null);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));
  const opts = useQuery({
    queryKey: ['assignment-form-options'],
    queryFn: async () => {
      const [c, t] = await Promise.all([
        supabase.from('cohorts').select('id, name').eq('archived', false).order('start_date', { ascending: false }),
        supabase.from('tracks').select('id, name').order('position'),
      ]);
      if (c.error) throw c.error;
      if (t.error) throw t.error;
      return { cohorts: c.data as { id: string; name: string }[], tracks: t.data as { id: string; name: string }[] };
    },
  });
  const learners = useQuery({
    queryKey: ['assignment-form-learners', f.cohortId],
    enabled: mode === 'selected' && Boolean(f.cohortId),
    queryFn: async () => {
      const { data, error } = await supabase.from('cohort_enrolments').select('participant_id, participants(participant_no, profiles(first_name, last_name))').eq('cohort_id', f.cohortId);
      if (error) throw error;
      return (data ?? []) as unknown as { participant_id: string; participants: { participant_no: string; profiles: { first_name: string | null; last_name: string | null } | null } | null }[];
    },
  });
  const create = useMutation({
    mutationFn: async () => {
      const err = validateAssignment(f) ?? (mode === 'selected' && chosen.length === 0 ? 'Choose at least one learner' : null);
      if (err) throw new Error(err);
      const { data, error } = await supabase.from('assignments').insert({
        cohort_id: f.cohortId, track_id: mode === 'cohort' ? f.trackId || null : null, title: f.title.trim(), instructions: f.instructions.trim() || null,
        due_at: f.dueAt ? new Date(f.dueAt).toISOString() : null, allow_resubmission: f.resubmit, max_score: f.maxScore.trim() ? Number(f.maxScore) : null, component: f.component,
      }).select('id').single();
      if (error) throw error;
      if (mode === 'selected') {
        const id = (data as { id: string }).id;
        const { error: rErr } = await supabase.from('assignment_recipients').insert(chosen.map((participant_id) => ({ assignment_id: id, participant_id })));
        if (rErr) {
          await supabase.from('assignments').delete().eq('id', id);   // never leave a half-assigned task that the whole cohort could see
          throw rErr;
        }
      }
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['staff-assignments'] }); onDone(); },
    onError: (e: Error) => setMsg(e.message),
  });
  return (
    <div className="grid gap-3 rounded-card border border-purple-100 p-5">
      <label className="grid gap-1 text-sm font-medium">Cohort
        <select value={f.cohortId} onChange={(e) => { set('cohortId', e.target.value); setChosen([]); }} className={field}>
          <option value="">Choose a cohort</option>{opts.data?.cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <fieldset className="grid gap-2 text-sm">
        <legend className="font-medium">Assign to</legend>
        <label className="flex items-center gap-2"><input type="radio" name="assign-mode" checked={mode === 'cohort'} onChange={() => setMode('cohort')} /> The whole cohort or one track</label>
        <label className="flex items-center gap-2"><input type="radio" name="assign-mode" checked={mode === 'selected'} onChange={() => { setMode('selected'); setChosen([]); }} /> Selected learners only</label>
      </fieldset>
      {mode === 'cohort' ? (
        <label className="grid gap-1 text-sm font-medium">For
          <select value={f.trackId} onChange={(e) => set('trackId', e.target.value)} className={field}>
            <option value="">Everyone in the cohort</option>{opts.data?.tracks.map((t) => <option key={t.id} value={t.id}>Only {t.name}</option>)}
          </select>
        </label>
      ) : (
        <fieldset className="grid gap-2 text-sm">
          <legend className="font-medium">Learners</legend>
          {!f.cohortId && <p className="text-ink/70">Choose a cohort first.</p>}
          {learners.isLoading && <p role="status">Loading learners…</p>}
          {learners.isError && <p role="alert" className="text-danger">Could not load the learners.</p>}
          {(learners.data ?? []).map((l) => {
            const name = `${l.participants?.profiles?.first_name ?? ''} ${l.participants?.profiles?.last_name ?? ''}`.trim() || 'Unnamed';
            return (
              <label key={l.participant_id} className="flex items-center gap-2">
                <input type="checkbox" checked={chosen.includes(l.participant_id)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, l.participant_id] : c.filter((x) => x !== l.participant_id)))} />
                {name} <span className="text-ink/60">{l.participants?.participant_no}</span>
              </label>
            );
          })}
          <p className="text-xs text-ink/60">Only the chosen learners will see this assignment, and only they are expected to submit it.</p>
        </fieldset>
      )}
      <label className="grid gap-1 text-sm font-medium">Counts towards
        <select value={f.component} onChange={(e) => set('component', e.target.value as typeof f.component)} className={field}>
          {(['task', 'final_project', 'reflection'] as const).map((c) => <option key={c} value={c}>{COMPONENT_LABEL[c]}</option>)}
        </select>
        <span className="text-xs font-normal text-ink/60">Only assignments with a maximum score add to the weighted result.</span>
      </label>
      <label className="grid gap-1 text-sm font-medium">Title<input value={f.title} onChange={(e) => set('title', e.target.value)} className={field} /></label>
      <label className="grid gap-1 text-sm font-medium">Instructions<textarea rows={4} value={f.instructions} onChange={(e) => set('instructions', e.target.value)} className={field} /></label>
      <div className="flex flex-wrap gap-4">
        <label className="grid gap-1 text-sm font-medium">Due<input type="datetime-local" value={f.dueAt} onChange={(e) => set('dueAt', e.target.value)} className={field} /></label>
        <label className="grid gap-1 text-sm font-medium">Maximum score (blank = feedback only)<input inputMode="decimal" value={f.maxScore} onChange={(e) => set('maxScore', e.target.value)} className={`${field} w-40`} /></label>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.resubmit} onChange={(e) => set('resubmit', e.target.checked)} /> Allow resubmission when I return the work</label>
      <div><Button disabled={create.isPending} onClick={() => { setMsg(null); create.mutate(); }}>{create.isPending ? 'Saving…' : 'Create assignment'}</Button></div>
      {msg && <p role="alert" className="text-sm text-danger">{msg}</p>}
    </div>
  );
}
