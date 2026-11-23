import { useState, type ChangeEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { FILE_NOT_AVAILABLE } from '@/lib/files';
import { useAuth } from '@/features/auth/AuthProvider';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import type { AttendanceStatus, CurriculumSession } from '@/types/database';
import { safeExternalUrl } from '@/features/resources/rules';
import { LessonPlanView } from '@/features/curriculum/LessonPlanView';
import { completeBlocker, expectedRoster, missingAttendance, RESOURCE_KINDS, safeFileName, summariseAttendance, validateResource, type ResourceKind } from './rules';

interface Sched {
  id: string; cohort_id: string; trainer_id: string | null; starts_at: string; ends_at: string; status: string; mode: string; venue: string | null; meeting_url: string | null;
  curriculum_sessions: CurriculumSession | null; cohorts: { name: string } | null;
}
interface Enrol { participant_id: string; track_id: string | null; participants: { participant_no: string; profiles: { first_name: string; last_name: string } | null } | null }
interface Resource { id: string; title: string; kind: ResourceKind; storage_path: string | null; external_url: string | null; visible_to_participants: boolean }
interface Report { summary: string | null; challenges: string | null; follow_ups: string | null }

const STATUSES: { value: AttendanceStatus; label: string }[] = [
  { value: 'present', label: 'Present' }, { value: 'late', label: 'Late' }, { value: 'excused', label: 'Excused' }, { value: 'absent', label: 'Absent' },
];
const field = 'rounded-control border border-purple-200 px-3 py-2 font-normal';

export function SessionDetailPage() {
  const { scheduleId = '' } = useParams();
  const q = useQuery({
    queryKey: ['session', scheduleId],
    queryFn: async () => {
      const { data, error } = await supabase.from('session_schedules')
        .select('id, cohort_id, trainer_id, starts_at, ends_at, status, mode, venue, meeting_url, curriculum_sessions(*), cohorts(name)').eq('id', scheduleId).maybeSingle();
      if (error) throw error;
      return data as unknown as Sched | null;
    },
  });
  if (q.isLoading) return <p role="status">Loading session…</p>;
  if (q.isError) return <p role="alert" className="text-danger">Could not load this session.</p>;
  const s = q.data;
  if (!s || !s.curriculum_sessions) return <EmptyState title="Session not found">It may have been removed, or you may not have access.</EmptyState>;
  const cs = s.curriculum_sessions;

  return (
    <section className="grid max-w-3xl gap-8">
      <header>
        <Link to="/sessions" className="text-sm text-purple-700 underline">All sessions</Link>
        <h1 className="mt-1 text-2xl font-bold text-purple-700">Session {cs.session_no}: {cs.title}</h1>
        <p className="text-sm text-ink/70">{s.cohorts?.name} · {new Date(s.starts_at).toLocaleString()} to {new Date(s.ends_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {s.mode}{s.venue ? ` · ${s.venue}` : ''} · <strong>{s.status}</strong></p>
        {s.meeting_url && <p className="text-sm"><a className="text-purple-700 underline" href={s.meeting_url} target="_blank" rel="noopener noreferrer">Open meeting link</a></p>}
      </header>
      <Plan cs={cs} />
      <div className="grid gap-3 rounded-card border border-purple-100 p-5">
        <h2 className="font-display text-xl font-semibold text-purple-900">Detailed lesson plan</h2>
        <LessonPlanView sessionId={cs.id} durationMinutes={cs.duration_minutes} />
      </div>
      <Attendance sched={s} />
      <Resources cs={cs} />
      <ReportForm scheduleId={s.id} />
    </section>
  );
}

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return <div><h3 className="text-sm font-semibold text-ink/70">{title}</h3><ul className="mt-1 list-disc pl-5 text-sm">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
}

function Plan({ cs }: { cs: CurriculumSession }) {
  // Official topics (approved in the Curriculum Approval Centre) and topics still awaiting approval. Rejected topics are hidden.
  const tp = useQuery({
    queryKey: ['session-topics', cs.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_session_topics').select('approved_topics, awaiting_topics').eq('session_id', cs.id).maybeSingle();
      if (error) throw error;
      return data as { approved_topics: string[]; awaiting_topics: string[] } | null;
    },
  });
  const approved = tp.data?.approved_topics ?? [];
  const awaiting = tp.isLoading ? [] : tp.isError || !tp.data ? cs.topics : tp.data.awaiting_topics;
  return (
    <div className="grid gap-3 rounded-card border border-purple-100 p-5">
      <h2 className="font-display text-xl font-semibold text-purple-900">Session plan <span className="text-sm font-normal text-ink/60">Week {cs.week_no}, {cs.duration_minutes} min</span></h2>
      {!cs.is_approved && <p className="text-xs text-warn">Draft content: not yet approved by programme management.</p>}
      {cs.description && <p className="text-sm">{cs.description}</p>}
      <List title="Objectives" items={cs.objectives} />
      <List title="Activities" items={cs.activities} />
      {approved.length > 0 && <List title="Approved topics" items={approved} />}
      {awaiting.length > 0 && <List title="Proposed topics (awaiting approval, confirm with your coordinator before teaching)" items={awaiting} />}
      {cs.expected_output && <p className="text-sm"><span className="font-medium">Expected output:</span> {cs.expected_output}</p>}
    </div>
  );
}

function Attendance({ sched }: { sched: Sched }) {
  const qc = useQueryClient();
  const cs = sched.curriculum_sessions!;
  const [edits, setEdits] = useState<Record<string, AttendanceStatus>>({});

  const roster = useQuery({
    queryKey: ['session-roster', sched.id],
    queryFn: async () => {
      const [e, a] = await Promise.all([
        supabase.from('cohort_enrolments').select('participant_id, track_id, participants(participant_no, profiles(first_name, last_name))').eq('cohort_id', sched.cohort_id),
        supabase.from('attendance').select('participant_id, status').eq('schedule_id', sched.id),
      ]);
      if (e.error) throw e.error;
      if (a.error) throw a.error;
      return { enrols: e.data as unknown as Enrol[], saved: Object.fromEntries((a.data as { participant_id: string; status: AttendanceStatus }[]).map((r) => [r.participant_id, r.status])) as Record<string, AttendanceStatus> };
    },
  });
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['session-roster', sched.id] }); void qc.invalidateQueries({ queryKey: ['session', sched.id] }); void qc.invalidateQueries({ queryKey: ['my-sessions'] }); };

  const { session } = useAuth();
  const save = useMutation({
    mutationFn: async () => {
      const rows = Object.entries(edits).map(([participant_id, status]) => ({ schedule_id: sched.id, participant_id, status, recorded_by: session?.user.id, updated_at: new Date().toISOString() }));
      if (!rows.length) return;
      const { error } = await supabase.from('attendance').upsert(rows, { onConflict: 'schedule_id,participant_id' });
      if (error) throw error;
    },
    onSuccess: () => { setEdits({}); refresh(); },
  });
  const complete = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc('complete_session', { p_schedule: sched.id }); if (error) throw error; },
    onSuccess: refresh,
  });

  if (roster.isLoading) return <p role="status">Loading participants…</p>;
  if (roster.isError) return <p role="alert" className="text-danger">Could not load participants.</p>;

  const list = expectedRoster(roster.data!.enrols.map((e) => ({ ...e, participantId: e.participant_id, trackId: e.track_id })), cs.track_id);
  const marks: Record<string, AttendanceStatus | undefined> = { ...roster.data!.saved, ...edits };
  const missing = missingAttendance(list, marks);
  const blocker = completeBlocker({ status: sched.status, startsAt: sched.starts_at, missingCount: missing.length, hasUnsavedMarks: Object.keys(edits).length > 0 });
  const tally = summariseAttendance(Object.values(marks).filter((m): m is AttendanceStatus => Boolean(m)));
  const locked = sched.status === 'cancelled' || sched.status === 'rescheduled';

  return (
    <div className="grid gap-3">
      <h2 className="font-display text-xl font-semibold text-purple-900">Attendance</h2>
      {cs.track_id && <p className="text-sm text-ink/70">This is a track session, so only participants who chose this track are listed.</p>}
      {list.length === 0 ? <EmptyState title="No participants expected">{cs.track_id ? 'Nobody has chosen this track yet.' : 'No participants are enrolled in this cohort yet.'}</EmptyState> : (
        <>
          <p className="text-sm text-ink/70">{tally.present} present · {tally.late} late · {tally.excused} excused · {tally.absent} absent · {missing.length} not marked</p>
          <ul className="divide-y divide-purple-100 rounded-card border border-purple-100">
            {list.map((r) => (
              <li key={r.participantId} className="flex flex-wrap items-center justify-between gap-2 p-3">
                <span>{r.participants?.profiles?.first_name} {r.participants?.profiles?.last_name} <span className="text-xs text-ink/60">{r.participants?.participant_no}</span></span>
                <fieldset className="flex gap-2" disabled={locked} aria-label={`Attendance for ${r.participants?.profiles?.first_name ?? 'participant'}`}>
                  {STATUSES.map((st) => (
                    <label key={st.value} className="flex items-center gap-1 text-sm">
                      <input type="radio" name={`${sched.id}-${r.participantId}`} checked={marks[r.participantId] === st.value} onChange={() => setEdits((m) => ({ ...m, [r.participantId]: st.value }))} />{st.label}
                    </label>
                  ))}
                </fieldset>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button variant="quiet" disabled={locked || missing.length === 0} onClick={() => setEdits((m) => ({ ...m, ...Object.fromEntries(missing.map((id) => [id, 'present' as AttendanceStatus])) }))}>Mark everyone not yet marked as present</Button>
            <Button disabled={locked || save.isPending || Object.keys(edits).length === 0} onClick={() => save.mutate()}>Save attendance</Button>
            {sched.status === 'scheduled' && <Button variant="accent" disabled={blocker !== null || complete.isPending} title={blocker ?? undefined} onClick={() => complete.mutate()}>Mark session completed</Button>}
          </div>
          {sched.status === 'scheduled' && blocker && <p className="text-sm text-ink/70">To complete: {blocker.toLowerCase()}.</p>}
          {[save, complete].map((m, i) => m.isError && <p key={i} role="alert" className="text-sm text-danger">{(m.error as Error).message}</p>)}
        </>
      )}
    </div>
  );
}

function Resources({ cs }: { cs: CurriculumSession }) {
  const qc = useQueryClient();
  const { session } = useAuth();
  const [title, setTitle] = useState(''); const [kind, setKind] = useState<ResourceKind>('document');
  const [url, setUrl] = useState(''); const [file, setFile] = useState<File | null>(null); const [share, setShare] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['session-resources', cs.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('learning_resources').select('id, title, kind, storage_path, external_url, visible_to_participants').eq('curriculum_session_id', cs.id).order('created_at');
      if (error) throw error;
      return data as Resource[];
    },
  });
  const add = useMutation({
    mutationFn: async () => {
      const p = validateResource({ title, kind, url, file });
      if (p) throw new Error(p);
      let storage_path: string | null = null;
      if (file) {
        storage_path = `${cs.id}/${Date.now()}-${safeFileName(file.name)}`;
        const up = await supabase.storage.from('learning-resources').upload(storage_path, file);
        if (up.error) throw up.error;
      }
      const { error } = await supabase.from('learning_resources').insert({
        curriculum_session_id: cs.id, track_id: cs.track_id, title: title.trim(), kind, storage_path, external_url: url.trim() || null, uploaded_by: session?.user.id, visible_to_participants: share,
      });
      if (error) {
        if (storage_path) await supabase.storage.from('learning-resources').remove([storage_path]);
        throw error;
      }
    },
    onMutate: () => setProblem(null),
    onSuccess: () => { setTitle(''); setUrl(''); setFile(null); setShare(false); void qc.invalidateQueries({ queryKey: ['session-resources', cs.id] }); },
  });
  const toggle = useMutation({
    mutationFn: async (r: Resource) => {
      const { data, error } = await supabase.from('learning_resources').update({ visible_to_participants: !r.visible_to_participants }).eq('id', r.id).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Could not change sharing for this resource.');
    },
    onError: (e: Error) => setProblem(e.message),
    onSuccess: () => { setProblem(null); void qc.invalidateQueries({ queryKey: ['session-resources', cs.id] }); },
  });
  const open = async (r: Resource) => {
    if (r.external_url) {
      const href = safeExternalUrl(r.external_url);
      if (!href) { setProblem('That link is not a valid web address.'); return; }
      window.open(href, '_blank', 'noopener,noreferrer'); return;
    }
    const { data, error } = await supabase.storage.from('learning-resources').createSignedUrl(r.storage_path!, 300);
    if (error || !data) { setProblem(FILE_NOT_AVAILABLE); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  return (
    <div className="grid gap-3">
      <h2 className="font-display text-xl font-semibold text-purple-900">Resources</h2>
      {list.isLoading ? <p role="status">Loading…</p> : !list.data?.length ? <p className="text-sm text-ink/60">No resources attached to this session yet.</p> : (
        <ul className="divide-y divide-purple-100 rounded-card border border-purple-100">
          {list.data.map((r) => <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"><span>{r.title} <span className="text-xs text-ink/60">{r.kind} · {r.visible_to_participants ? 'shared with participants' : 'trainers only'}</span></span><span className="flex gap-2"><Button variant="quiet" disabled={toggle.isPending} onClick={() => toggle.mutate(r)}>{r.visible_to_participants ? 'Stop sharing' : 'Share with participants'}</Button><Button variant="quiet" onClick={() => void open(r)}>Open</Button></span></li>)}
        </ul>
      )}
      <form className="grid gap-3 rounded-card border border-purple-100 p-5 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
        <label className="grid gap-1 text-sm font-medium">Title<input className={field} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="grid gap-1 text-sm font-medium">Type<select className={field} value={kind} onChange={(e) => setKind(e.target.value as ResourceKind)}>{RESOURCE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-medium">Link<input className={field} placeholder="https://" value={url} onChange={(e) => setUrl(e.target.value)} /></label>
        <label className="grid gap-1 text-sm font-medium">or upload a file (PDF, Word, PowerPoint, Excel, JPG, PNG or MP4, up to 50 MB)<input type="file" accept=".pdf,.docx,.pptx,.ppt,.xlsx,.jpg,.jpeg,.png,.mp4" className="text-sm font-normal" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} /> Share with participants (leave off for trainer-only material)</label>
        <div className="sm:col-span-2"><Button type="submit" disabled={add.isPending}>Add resource</Button></div>
        {(add.isError || problem) && <p role="alert" className="text-sm text-danger sm:col-span-2">{problem ?? (add.error as Error).message}</p>}
      </form>
    </div>
  );
}

function ReportForm({ scheduleId }: { scheduleId: string }) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Report | null>(null);
  const q = useQuery({
    queryKey: ['session-report', scheduleId],
    queryFn: async () => {
      const { data, error } = await supabase.from('session_reports').select('summary, challenges, follow_ups').eq('schedule_id', scheduleId).maybeSingle();
      if (error) throw error;
      return (data as Report | null) ?? { summary: '', challenges: '', follow_ups: '' };
    },
  });
  const save = useMutation({
    mutationFn: async (r: Report) => {
      const { error } = await supabase.from('session_reports').upsert({ schedule_id: scheduleId, ...r }, { onConflict: 'schedule_id' });
      if (error) throw error;
    },
    onSuccess: () => { setDraft(null); void qc.invalidateQueries({ queryKey: ['session-report', scheduleId] }); },
  });
  if (q.isLoading) return <p role="status">Loading report…</p>;
  if (q.isError) return <p role="alert" className="text-danger">Could not load the session report.</p>;
  const value = draft ?? q.data!;
  const set = (k: keyof Report) => (e: ChangeEvent<HTMLTextAreaElement>) => setDraft({ ...value, [k]: e.target.value });
  return (
    <div className="grid gap-3">
      <h2 className="font-display text-xl font-semibold text-purple-900">Delivery report</h2>
      <p className="text-sm text-ink/70">Visible to programme staff and the M&amp;E officer. Do not put participants' personal or safeguarding details here.</p>
      {([['summary', 'What was covered'], ['challenges', 'Challenges'], ['follow_ups', 'Follow-ups for the next session or the coordinator']] as const).map(([k, label]) => (
        <label key={k} className="grid gap-1 text-sm font-medium">{label}<textarea className={`${field} min-h-20`} value={value[k] ?? ''} onChange={set(k)} /></label>
      ))}
      <div><Button disabled={!draft || save.isPending} onClick={() => save.mutate(value)}>Save report</Button></div>
      {save.isError && <p role="alert" className="text-sm text-danger">{(save.error as Error).message}</p>}
      {save.isSuccess && !draft && <p role="status" className="text-sm text-ok">Report saved.</p>}
    </div>
  );
}
