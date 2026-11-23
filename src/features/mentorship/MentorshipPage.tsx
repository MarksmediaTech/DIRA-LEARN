import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { MentorshipSession } from '@/types/database';
import { lastSessionDate, parseActionPoints, validateMentoringSession } from './rules';

interface Person { first_name: string; last_name: string }
interface AssignmentRow { id: string; mentor_id: string; participant_id: string; participants: { participant_no: string; profiles: Person | null } | null }
const nameOf = (p: Person | null | undefined) => (p ? `${p.first_name} ${p.last_name}`.trim() || 'Unnamed' : 'Unnamed');
// The database compares against its own (UTC) date, so the form uses the UTC date too.
const todayUtc = () => new Date().toISOString().slice(0, 10);

export function MentorshipPage() {
  const { profile } = useAuth();
  if (!profile) return null;
  if (profile.role === 'mentor') return <MentorView mentorId={profile.id} />;
  if (profile.role === 'participant') return <MenteeView />;
  return <StaffView />;
}

// ---------- mentor ----------
function MentorView({ mentorId }: { mentorId: string }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const assignments = useQuery({
    queryKey: ['mentor-assignments', mentorId],
    queryFn: async () => {
      const { data, error } = await supabase.from('mentorship_assignments').select('id, mentor_id, participant_id, participants(participant_no, profiles(first_name, last_name))').eq('mentor_id', mentorId);
      if (error) throw error;
      return data as unknown as AssignmentRow[];
    },
  });
  const sessions = useQuery({
    queryKey: ['mentor-sessions', mentorId],
    enabled: Boolean(assignments.data?.length),
    queryFn: async () => {
      const { data, error } = await supabase.from('mentorship_sessions').select('id, assignment_id, held_on, summary, action_points, feedback, shared_with_mentee').order('held_on', { ascending: false });
      if (error) throw error;
      return data as MentorshipSession[];
    },
  });
  useEffect(() => { if (!selected && assignments.data?.length) setSelected(assignments.data[0]!.id); }, [assignments.data, selected]);

  const [heldOn, setHeldOn] = useState(todayUtc());
  const [summary, setSummary] = useState('');
  const [points, setPoints] = useState('');
  const [feedback, setFeedback] = useState('');
  const [share, setShare] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const problem = validateMentoringSession({ heldOn, summary }, todayUtc());
      if (problem) throw new Error(problem);
      const parsed = parseActionPoints(points);
      if (parsed.error) throw new Error(parsed.error);
      const { error: e } = await supabase.from('mentorship_sessions').insert({
        assignment_id: selected, held_on: heldOn, summary: summary.trim(), action_points: parsed.points, feedback: feedback.trim() || null, shared_with_mentee: share,
      });
      if (e) throw e;
    },
    onSuccess: () => { setSummary(''); setPoints(''); setFeedback(''); setShare(false); setError(null); void qc.invalidateQueries({ queryKey: ['mentor-sessions'] }); },
    onError: (e: Error) => setError(e.message),
  });
  const toggleShare = useMutation({
    mutationFn: async (s: MentorshipSession) => {
      const { error: e } = await supabase.from('mentorship_sessions').update({ shared_with_mentee: !s.shared_with_mentee }).eq('id', s.id);
      if (e) throw e;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mentor-sessions'] }),
    onError: (e: Error) => setError(e.message),
  });

  if (assignments.isLoading) return <p role="status">Loading…</p>;
  if (assignments.isError) return <p role="alert" className="text-danger">Could not load your mentees.</p>;
  if (!assignments.data?.length) return <EmptyState title="No mentees yet">The programme team assigns participants to you. They will appear here.</EmptyState>;
  const current = assignments.data.find((a) => a.id === selected);
  const mine = (sessions.data ?? []).filter((s) => s.assignment_id === selected);

  return (
    <section className="grid max-w-4xl gap-5">
      <h1 className="text-2xl font-bold text-purple-700">My mentees</h1>
      <ul className="flex flex-wrap gap-2" aria-label="Mentees">
        {assignments.data.map((a) => {
          const last = lastSessionDate((sessions.data ?? []).filter((s) => s.assignment_id === a.id).map((s) => s.held_on));
          return (
            <li key={a.id}>
              <button type="button" aria-pressed={a.id === selected} onClick={() => setSelected(a.id)}
                className={`rounded-card border px-4 py-2 text-left text-sm ${a.id === selected ? 'border-purple-600 bg-purple-50' : 'border-purple-100'}`}>
                <span className="block font-semibold">{nameOf(a.participants?.profiles)}</span>
                <span className="block text-xs text-ink/60">{a.participants?.participant_no} · {last ? `last session ${last}` : 'no sessions logged'}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {current && (
        <>
          <form className="grid gap-3 rounded-card border border-purple-100 p-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <h2 className="font-display text-lg font-semibold">Log a session with {nameOf(current.participants?.profiles)}</h2>
            <p className="rounded-control bg-amber-50 p-2 text-sm">Keep personal or safeguarding details out of these notes. If someone may be at risk, follow the safeguarding route you were given.</p>
            <label className="grid max-w-xs gap-1 text-sm font-medium">Date held
              <input type="date" value={heldOn} max={todayUtc()} onChange={(e) => setHeldOn(e.target.value)} className="rounded-control border border-purple-200 px-3 py-2 font-normal" />
            </label>
            <label className="grid gap-1 text-sm font-medium">Summary
              <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={3} className="rounded-control border border-purple-200 px-3 py-2 font-normal" />
            </label>
            <label className="grid gap-1 text-sm font-medium">Action points <span className="font-normal text-ink/60">(one per line)</span>
              <textarea value={points} onChange={(e) => setPoints(e.target.value)} rows={3} className="rounded-control border border-purple-200 px-3 py-2 font-normal" />
            </label>
            <label className="grid gap-1 text-sm font-medium">Feedback for the mentee <span className="font-normal text-ink/60">(optional)</span>
              <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={2} className="rounded-control border border-purple-200 px-3 py-2 font-normal" />
            </label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /> Share this record with the mentee (they will see the summary, action points and feedback)</label>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <Button type="submit" disabled={save.isPending} className="justify-self-start">Save session</Button>
          </form>
          <div className="grid gap-3">
            <h2 className="font-display text-lg font-semibold">Past sessions</h2>
            {sessions.isLoading && <p role="status">Loading sessions…</p>}
            {!sessions.isLoading && !mine.length && <p className="text-sm text-ink/70">No sessions logged yet.</p>}
            {mine.map((s) => (
              <article key={s.id} className="rounded-card border border-purple-100 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{s.held_on}</h3>
                  <Button variant="quiet" type="button" onClick={() => toggleShare.mutate(s)}>{s.shared_with_mentee ? 'Shared with mentee: stop sharing' : 'Private: share with mentee'}</Button>
                </div>
                <p className="mt-2 whitespace-pre-wrap">{s.summary}</p>
                {s.action_points.length > 0 && <ul className="mt-2 list-disc pl-5">{s.action_points.map((p) => <li key={p}>{p}</li>)}</ul>}
                {s.feedback && <p className="mt-2 whitespace-pre-wrap text-ink/80"><strong>Feedback:</strong> {s.feedback}</p>}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ---------- participant ----------
function MenteeView() {
  const q = useQuery({
    queryKey: ['my-mentor'],
    queryFn: async () => {
      const { data: a, error } = await supabase.from('mentorship_assignments').select('id, mentor_id').maybeSingle();
      if (error) throw error;
      if (!a) return null;
      const [m, s] = await Promise.all([
        supabase.from('profiles').select('first_name, last_name').eq('id', a.mentor_id).maybeSingle(),
        supabase.from('mentorship_sessions').select('id, assignment_id, held_on, summary, action_points, feedback, shared_with_mentee').order('held_on', { ascending: false }),
      ]);
      if (s.error) throw s.error;
      return { mentor: nameOf(m.data as Person | null), sessions: s.data as MentorshipSession[] };
    },
  });
  if (q.isLoading) return <p role="status">Loading…</p>;
  if (q.isError) return <p role="alert" className="text-danger">Could not load your mentoring.</p>;
  if (!q.data) return <EmptyState title="No mentor yet">When the programme team gives you a mentor, their name appears here.</EmptyState>;
  return (
    <section className="grid max-w-3xl gap-4">
      <h1 className="text-2xl font-bold text-purple-700">My mentor</h1>
      <p>Your mentor is <strong>{q.data.mentor}</strong>.</p>
      <h2 className="font-display text-lg font-semibold">Sessions your mentor shared with you</h2>
      {!q.data.sessions.length && <p className="text-sm text-ink/70">Nothing has been shared yet.</p>}
      {q.data.sessions.map((s) => (
        <article key={s.id} className="rounded-card border border-purple-100 p-4 text-sm">
          <h3 className="font-semibold">{s.held_on}</h3>
          <p className="mt-2 whitespace-pre-wrap">{s.summary}</p>
          {s.action_points.length > 0 && <><p className="mt-2 font-semibold">Action points</p><ul className="list-disc pl-5">{s.action_points.map((p) => <li key={p}>{p}</li>)}</ul></>}
          {s.feedback && <p className="mt-2 whitespace-pre-wrap"><strong>Feedback:</strong> {s.feedback}</p>}
        </article>
      ))}
    </section>
  );
}

// ---------- staff ----------
function StaffView() {
  const qc = useQueryClient();
  const [mentorId, setMentorId] = useState('');
  const [participantId, setParticipantId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const data = useQuery({
    queryKey: ['mentorship-staff'],
    queryFn: async () => {
      const [a, m, p, s] = await Promise.all([
        supabase.from('mentorship_assignments').select('id, mentor_id, participant_id, participants(participant_no, profiles(first_name, last_name))'),
        supabase.from('profiles').select('id, first_name, last_name').eq('role', 'mentor').eq('status', 'active'),
        supabase.from('participants').select('id, participant_no, status, profiles(first_name, last_name)').neq('status', 'withdrawn'),
        supabase.from('mentorship_sessions').select('assignment_id, held_on'),
      ]);
      for (const r of [a, m, p, s]) if (r.error) throw r.error;
      return { assignments: a.data as unknown as AssignmentRow[], mentors: m.data as { id: string; first_name: string; last_name: string }[],
        participants: p.data as unknown as { id: string; participant_no: string; profiles: Person | null }[], sessions: s.data as { assignment_id: string; held_on: string }[] };
    },
  });
  const mentorName = useMemo(() => new Map((data.data?.mentors ?? []).map((m) => [m.id, nameOf(m)])), [data.data]);
  const free = (data.data?.participants ?? []).filter((p) => !data.data?.assignments.some((a) => a.participant_id === p.id));

  const assign = useMutation({
    mutationFn: async () => { const { error: e } = await supabase.from('mentorship_assignments').insert({ mentor_id: mentorId, participant_id: participantId }); if (e) throw e; },
    onSuccess: () => { setParticipantId(''); setError(null); void qc.invalidateQueries({ queryKey: ['mentorship-staff'] }); },
    onError: (e: Error) => setError(e.message),
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { const { error: e } = await supabase.from('mentorship_assignments').delete().eq('id', id); if (e) throw e; },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['mentorship-staff'] }),
    onError: (e: Error) => setError(e.message),
  });

  if (data.isLoading) return <p role="status">Loading…</p>;
  if (data.isError || !data.data) return <p role="alert" className="text-danger">Could not load mentorship.</p>;
  return (
    <section className="grid max-w-4xl gap-5">
      <h1 className="text-2xl font-bold text-purple-700">Mentorship</h1>
      <form className="grid gap-3 rounded-card border border-purple-100 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end" onSubmit={(e) => { e.preventDefault(); assign.mutate(); }}>
        <label className="grid gap-1 text-sm font-medium">Mentor
          <select value={mentorId} onChange={(e) => setMentorId(e.target.value)} className="rounded-control border border-purple-200 px-3 py-2 font-normal">
            <option value="">Choose a mentor</option>{data.data.mentors.map((m) => <option key={m.id} value={m.id}>{nameOf(m)}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-medium">Participant without a mentor
          <select value={participantId} onChange={(e) => setParticipantId(e.target.value)} className="rounded-control border border-purple-200 px-3 py-2 font-normal">
            <option value="">Choose a participant</option>{free.map((p) => <option key={p.id} value={p.id}>{nameOf(p.profiles)} ({p.participant_no})</option>)}
          </select>
        </label>
        <Button type="submit" disabled={!mentorId || !participantId || assign.isPending}>Assign</Button>
      </form>
      {!data.data.mentors.length && <p className="text-sm text-ink/70">No active mentor accounts exist yet. A super administrator can give an account the mentor role under Users.</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!data.data.assignments.length ? <EmptyState title="No mentoring pairs yet">Assign a mentor to a participant above.</EmptyState> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Mentoring pairs</caption>
            <thead><tr className="border-b border-purple-200"><th scope="col" className="p-2">Participant</th><th scope="col" className="p-2">Mentor</th><th scope="col" className="p-2">Last session</th><th scope="col" className="p-2"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {data.data.assignments.map((a) => (
                <tr key={a.id} className="border-b border-purple-100">
                  <th scope="row" className="p-2 font-medium">{nameOf(a.participants?.profiles)}<div className="text-xs font-normal text-ink/60">{a.participants?.participant_no}</div></th>
                  <td className="p-2">{mentorName.get(a.mentor_id) ?? 'Unknown'}</td>
                  <td className="p-2">{lastSessionDate(data.data!.sessions.filter((s) => s.assignment_id === a.id).map((s) => s.held_on)) ?? 'None logged'}</td>
                  <td className="p-2"><Button variant="quiet" type="button" onClick={() => { if (window.confirm('Remove this mentoring pair? Logged sessions are removed with it.')) remove.mutate(a.id); }}>Remove</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-ink/60">Mentors&apos; session notes are private to the mentor unless the mentor shares them. Staff see only the date of the latest session here.</p>
    </section>
  );
}
