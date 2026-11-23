import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { isStaffRole } from '@/lib/permissions';
import type { Cohort, Track } from '@/types/database';
import { scheduleSchema, type ScheduleInput } from './schema';
import { AccessPanel } from './AccessPanel';
import { findConflicts, localToIso, preselectTrack, seatsLeft, validateScheduleTimes, type Slot } from './rules';

interface EnrolRow { id: string; participant_id: string; track_id: string | null; participants: { participant_no: string; profiles: { first_name: string; last_name: string } | null } | null }
interface Unplaced { participant_id: string; participant_no: string; first_name: string; last_name: string }
interface AssignRow { id: string; trainer_id: string; track_id: string | null; profiles: { first_name: string; last_name: string } | null }
interface TrainerProfile { id: string; first_name: string; last_name: string }
interface CurSession { id: string; track_id: string | null; session_no: number; week_no: number; title: string; duration_minutes: number }
interface ScheduleRow { id: string; cohort_id: string; trainer_id: string | null; starts_at: string; ends_at: string; mode: string; venue: string | null; status: string; curriculum_session_id: string; curriculum_sessions: { title: string; track_id: string | null; session_no: number } | null }

const input = 'rounded-control border border-purple-200 px-3 py-2 font-normal';
const name = (p: { first_name: string; last_name: string } | null | undefined) => (p ? `${p.first_name} ${p.last_name}`.trim() : 'Unnamed');

export function CohortDetailPage() {
  const { cohortId = '' } = useParams();
  const { profile } = useAuth();
  const staff = profile ? isStaffRole(profile.role) : false;

  const cohort = useQuery({
    queryKey: ['cohort', cohortId],
    queryFn: async () => {
      const { data, error } = await supabase.from('cohorts').select('id, programme_id, name, start_date, end_date, capacity, archived, intake_label, season, recruitment_opens_on, recruitment_closes_on, access_opens_at, access_closes_at').eq('id', cohortId).maybeSingle();
      if (error) throw error;
      return data as Cohort | null;
    },
  });
  if (cohort.isLoading) return <p role="status">Loading cohort…</p>;
  if (cohort.isError) return <p role="alert" className="text-danger">Could not load this cohort.</p>;
  if (!cohort.data) return <EmptyState title="Cohort not found">It may have been removed, or you may not have access.</EmptyState>;
  const c = cohort.data;
  return (
    <section className="grid max-w-5xl gap-8">
      <header>
        <Link to="/cohorts" className="text-sm text-purple-700 underline">All cohorts</Link>
        <h1 className="mt-1 text-2xl font-bold text-purple-700">{c.name}{c.archived && <span className="ml-2 text-sm font-normal text-ink/60">(archived)</span>}</h1>
        <p className="text-sm text-ink/70">{c.start_date} to {c.end_date}</p>
        {staff && <CohortSettings cohort={c} />}
      </header>
      {staff && <AccessPanel cohort={c} />}
      <Roster cohort={c} staff={staff} />
      <Trainers cohort={c} staff={staff} />
      <Schedule cohort={c} staff={staff} />
    </section>
  );
}

function CohortSettings({ cohort }: { cohort: Cohort }) {
  const qc = useQueryClient();
  const [capacity, setCapacity] = useState(String(cohort.capacity));
  const save = useMutation({
    mutationFn: async (patch: Partial<Pick<Cohort, 'capacity' | 'archived'>>) => {
      const { error } = await supabase.from('cohorts').update(patch).eq('id', cohort.id);
      if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['cohort', cohort.id] }); void qc.invalidateQueries({ queryKey: ['cohorts'] }); },
  });
  const n = Number(capacity);
  const valid = Number.isInteger(n) && n >= 1 && n !== cohort.capacity;
  return (
    <div className="mt-3 flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-sm font-medium">Capacity<input type="number" min={1} className={`${input} w-28`} value={capacity} onChange={(e) => setCapacity(e.target.value)} /></label>
      <Button variant="quiet" disabled={!valid || save.isPending} onClick={() => save.mutate({ capacity: n })}>Update capacity</Button>
      <Button variant="quiet" disabled={save.isPending} onClick={() => save.mutate({ archived: !cohort.archived })}>{cohort.archived ? 'Restore cohort' : 'Archive cohort'}</Button>
      {save.isError && <p role="alert" className="w-full text-sm text-danger">{(save.error as Error).message}</p>}
    </div>
  );
}

function Roster({ cohort, staff }: { cohort: Cohort; staff: boolean }) {
  const qc = useQueryClient();
  const [pick, setPick] = useState('');
  const roster = useQuery({
    queryKey: ['cohort-roster', cohort.id],
    queryFn: async () => {
      const [r, t] = await Promise.all([
        supabase.from('cohort_enrolments').select('id, participant_id, track_id, participants(participant_no, profiles(first_name, last_name))').eq('cohort_id', cohort.id),
        supabase.from('tracks').select('id, code, name, focus, position').eq('programme_id', cohort.programme_id),
      ]);
      if (r.error) throw r.error;
      if (t.error) throw t.error;
      return { rows: r.data as unknown as EnrolRow[], tracks: new Map((t.data as Track[]).map((x) => [x.id, x.name])) };
    },
  });
  const unplaced = useQuery({
    queryKey: ['unplaced'], enabled: staff && !cohort.archived,
    queryFn: async () => {
      const { data, error } = await supabase.from('v_unplaced_participants').select('participant_id, participant_no, first_name, last_name').order('participant_no');
      if (error) throw error;
      return data as Unplaced[];
    },
  });
  // Programme tracks saved on the participant records (direct enrolment). A separate read, so that a database without the optional
  // participants.programme_track_id column simply preselects nothing instead of breaking the page.
  const savedTracks = useQuery({
    queryKey: ['unplaced-saved-tracks', unplaced.data?.map((u) => u.participant_id).join(',') ?? ''],
    enabled: staff && !cohort.archived && (unplaced.data?.length ?? 0) > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('participants').select('id, programme_track_id').in('id', unplaced.data!.map((u) => u.participant_id));
      if (error) return new Map<string, string | null>();
      return new Map((data as unknown as { id: string; programme_track_id: string | null }[]).map((x) => [x.id, x.programme_track_id]));
    },
  });
  const programmeTracks = roster.data ? Array.from(roster.data.tracks, ([id, trackName]) => ({ id, name: trackName })) : [];
  const [trackPick, setTrackPick] = useState('');
  const choose = (participantId: string) => {
    setPick(participantId);
    setTrackPick(participantId ? preselectTrack(savedTracks.data?.get(participantId), programmeTracks.map((t) => t.id)) : '');
  };
  const enrol = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('cohort_enrolments').insert({ cohort_id: cohort.id, participant_id: pick, ...(trackPick ? { track_id: trackPick, track_selected_at: new Date().toISOString() } : {}) });
      if (error) throw error;
    },
    onSuccess: () => { setPick(''); setTrackPick(''); void qc.invalidateQueries({ queryKey: ['cohort-roster', cohort.id] }); void qc.invalidateQueries({ queryKey: ['unplaced'] }); void qc.invalidateQueries({ queryKey: ['cohorts'] }); },
  });
  const enrolled = roster.data?.rows.length ?? 0;
  const left = seatsLeft({ capacity: cohort.capacity, enrolled });

  return (
    <div className="grid gap-3">
      <h2 className="font-display text-xl font-semibold text-purple-900">Participants <span className="text-base font-normal text-ink/70">({enrolled} of {cohort.capacity}, {left} places left)</span></h2>
      {staff && !cohort.archived && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm font-medium">Enrol a participant
            <select className={input} value={pick} onChange={(e) => choose(e.target.value)} disabled={left === 0}>
              <option value="">{left === 0 ? 'Cohort is full' : unplaced.data?.length === 0 ? 'No unplaced participants' : 'Choose a participant'}</option>
              {unplaced.data?.map((u) => <option key={u.participant_id} value={u.participant_id}>{u.first_name} {u.last_name} ({u.participant_no})</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">Programme track
            <select className={input} value={trackPick} onChange={(e) => setTrackPick(e.target.value)} disabled={!pick}>
              <option value="">Learner chooses later</option>
              {programmeTracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <Button disabled={!pick || enrol.isPending} onClick={() => enrol.mutate()}>Enrol</Button>
          {enrol.isError && <p role="alert" className="w-full text-sm text-danger">{(enrol.error as Error).message}</p>}
        </div>
      )}
      {roster.isLoading ? <p role="status">Loading participants…</p> : roster.isError ? <p role="alert" className="text-danger">Could not load participants.</p>
        : enrolled === 0 ? <EmptyState title="No participants enrolled yet">{staff ? 'Accepted applicants must be converted to participants first (Applications page), then enrolled here.' : undefined}</EmptyState>
        : (
          <ul className="divide-y divide-purple-100 rounded-card border border-purple-100">
            {roster.data!.rows.map((r) => (
              <li key={r.id} className="flex flex-wrap justify-between gap-2 p-3 text-sm">
                <span>{name(r.participants?.profiles)} <span className="text-xs text-ink/60">{r.participants?.participant_no}</span></span>
                <span className="text-ink/70">{r.track_id ? roster.data!.tracks.get(r.track_id) : 'Track not chosen yet'}</span>
              </li>
            ))}
          </ul>
        )}
    </div>
  );
}

function Trainers({ cohort, staff }: { cohort: Cohort; staff: boolean }) {
  const qc = useQueryClient();
  const [trainerId, setTrainerId] = useState('');
  const [trackId, setTrackId] = useState('');
  const assigned = useQuery({
    queryKey: ['cohort-trainers', cohort.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('trainer_assignments').select('id, trainer_id, track_id, profiles:trainer_id(first_name, last_name), tracks(name)').eq('cohort_id', cohort.id);
      if (error) throw error;
      return data as unknown as (AssignRow & { tracks: { name: string } | null })[];
    },
  });
  const options = useQuery({
    queryKey: ['trainer-options'], enabled: staff,
    queryFn: async () => {
      const [p, t] = await Promise.all([
        supabase.from('profiles').select('id, first_name, last_name').eq('role', 'trainer').eq('status', 'active').order('first_name'),
        supabase.from('tracks').select('id, name').eq('programme_id', cohort.programme_id).order('position'),
      ]);
      if (p.error) throw p.error;
      if (t.error) throw t.error;
      return { trainers: p.data as TrainerProfile[], tracks: t.data as { id: string; name: string }[] };
    },
  });
  const add = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('trainer_assignments').insert({ cohort_id: cohort.id, trainer_id: trainerId, track_id: trackId || null });
      if (error) throw error;
    },
    onSuccess: () => { setTrainerId(''); setTrackId(''); void qc.invalidateQueries({ queryKey: ['cohort-trainers', cohort.id] }); },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('trainer_assignments').delete().eq('id', id); if (error) throw error; },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cohort-trainers', cohort.id] }),
  });

  return (
    <div className="grid gap-3">
      <h2 className="font-display text-xl font-semibold text-purple-900">Trainers</h2>
      {staff && !cohort.archived && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-sm font-medium">Trainer
            <select className={input} value={trainerId} onChange={(e) => setTrainerId(e.target.value)}>
              <option value="">{options.data?.trainers.length === 0 ? 'No active trainer accounts' : 'Choose a trainer'}</option>
              {options.data?.trainers.map((t) => <option key={t.id} value={t.id}>{name(t)}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">For
            <select className={input} value={trackId} onChange={(e) => setTrackId(e.target.value)}>
              <option value="">Whole cohort (shared core sessions and all tracks)</option>
              {options.data?.tracks.map((t) => <option key={t.id} value={t.id}>{t.name} only</option>)}
            </select>
          </label>
          <Button disabled={!trainerId || add.isPending} onClick={() => add.mutate()}>Assign</Button>
          {add.isError && <p role="alert" className="w-full text-sm text-danger">{(add.error as Error).message}</p>}
        </div>
      )}
      {assigned.isLoading ? <p role="status">Loading trainers…</p> : !assigned.data?.length ? <EmptyState title="No trainers assigned yet" />
        : (
          <ul className="divide-y divide-purple-100 rounded-card border border-purple-100">
            {assigned.data.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <span>{name(a.profiles)} <span className="text-ink/60">· {a.tracks?.name ?? 'whole cohort'}</span></span>
                {staff && <Button variant="quiet" disabled={remove.isPending} onClick={() => remove.mutate(a.id)}>Remove</Button>}
              </li>
            ))}
          </ul>
        )}
      {remove.isError && <p role="alert" className="text-sm text-danger">{(remove.error as Error).message}</p>}
    </div>
  );
}

function Schedule({ cohort, staff }: { cohort: Cohort; staff: boolean }) {
  const qc = useQueryClient();

  const data = useQuery({
    queryKey: ['cohort-schedule', cohort.id],
    queryFn: async () => {
      const [s, cs, ta, all] = await Promise.all([
        supabase.from('session_schedules').select('id, cohort_id, trainer_id, starts_at, ends_at, mode, venue, status, curriculum_session_id, curriculum_sessions(title, track_id, session_no)').eq('cohort_id', cohort.id).order('starts_at'),
        supabase.from('curriculum_sessions').select('id, track_id, session_no, week_no, title, duration_minutes').eq('programme_id', cohort.programme_id).order('session_no'),
        supabase.from('trainer_assignments').select('trainer_id, track_id, profiles:trainer_id(first_name, last_name)').eq('cohort_id', cohort.id),
        // Other cohorts' sessions are only visible to staff; used to warn about trainer double-booking early.
        staff ? supabase.from('session_schedules').select('id, cohort_id, trainer_id, starts_at, ends_at, status, curriculum_sessions(track_id)').neq('cohort_id', cohort.id).gte('ends_at', new Date().toISOString()) : Promise.resolve({ data: [], error: null }),
      ]);
      for (const r of [s, cs, ta, all]) if (r.error) throw r.error;
      return {
        schedules: s.data as unknown as ScheduleRow[], sessions: cs.data as CurSession[],
        trainers: ta.data as unknown as { trainer_id: string; track_id: string | null; profiles: { first_name: string; last_name: string } | null }[],
        others: (all.data as unknown as { id: string; cohort_id: string; trainer_id: string | null; starts_at: string; ends_at: string; status: string; curriculum_sessions: { track_id: string | null } | null }[])
          .map<Slot>((x) => ({ id: x.id, cohortId: x.cohort_id, trainerId: x.trainer_id, trackId: x.curriculum_sessions?.track_id ?? null, startsAt: x.starts_at, endsAt: x.ends_at, status: x.status })),
      };
    },
  });

  const { register, handleSubmit, watch, reset, formState: { errors } } = useForm<ScheduleInput>({ resolver: zodResolver(scheduleSchema), defaultValues: { mode: 'physical' } });
  const chosen = data.data?.sessions.find((x) => x.id === watch('curriculumSessionId'));
  const trainerChoices = (data.data?.trainers ?? []).filter((t) => t.track_id === null || t.track_id === chosen?.track_id);
  const scheduledIds = new Set((data.data?.schedules ?? []).filter((s) => s.status === 'scheduled' || s.status === 'completed').map((s) => s.curriculum_session_id));

  const create = useMutation({
    mutationFn: async (v: ScheduleInput) => {
      const d = data.data!;
      const cs = d.sessions.find((x) => x.id === v.curriculumSessionId)!;
      const problem = validateScheduleTimes({ startsAt: v.startsAt, endsAt: v.endsAt, cohortStart: cohort.start_date, cohortEnd: cohort.end_date });
      if (problem) throw new Error(problem);
      const slot: Slot = { cohortId: cohort.id, trainerId: v.trainerId || null, trackId: cs.track_id, startsAt: localToIso(v.startsAt), endsAt: localToIso(v.endsAt), status: 'scheduled' };
      const existing: Slot[] = [...d.schedules.map((s) => ({ id: s.id, cohortId: s.cohort_id, trainerId: s.trainer_id, trackId: s.curriculum_sessions?.track_id ?? null, startsAt: s.starts_at, endsAt: s.ends_at, status: s.status })), ...d.others];
      const conflicts = findConflicts(slot, existing);
      if (conflicts.length) throw new Error(conflicts[0]!.kind === 'trainer' ? 'That trainer already has a session at this time.' : 'This cohort already has a session at this time.');
      const { error } = await supabase.from('session_schedules').insert({
        cohort_id: cohort.id, curriculum_session_id: v.curriculumSessionId, trainer_id: v.trainerId || null,
        starts_at: slot.startsAt, ends_at: slot.endsAt, mode: v.mode, venue: v.venue || null, meeting_url: v.meetingUrl || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { reset({ mode: 'physical' }); void qc.invalidateQueries({ queryKey: ['cohort-schedule', cohort.id] }); void qc.invalidateQueries({ queryKey: ['schedules'] }); },
  });
  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'cancelled' | 'scheduled' }) => {
      const { error } = await supabase.from('session_schedules').update({ status }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['cohort-schedule', cohort.id] }),
  });

  if (data.isLoading) return <p role="status">Loading schedule…</p>;
  if (data.isError) return <p role="alert" className="text-danger">Could not load the schedule.</p>;
  const d = data.data!;
  const trainerName = (id: string | null) => name(d.trainers.find((t) => t.trainer_id === id)?.profiles);

  return (
    <div className="grid gap-3">
      <h2 className="font-display text-xl font-semibold text-purple-900">Schedule</h2>
      {staff && !cohort.archived && (
        <form onSubmit={handleSubmit((v) => create.mutate(v))} noValidate className="grid gap-3 rounded-card border border-purple-100 p-5 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium sm:col-span-2">Session
            <select className={input} {...register('curriculumSessionId')}>
              <option value="">Choose a session</option>
              {d.sessions.map((s) => <option key={s.id} value={s.id}>{`Week ${s.week_no} · Session ${s.session_no}: ${s.title}${s.track_id ? ' (track)' : ' (core)'}${scheduledIds.has(s.id) ? ' — already scheduled' : ''}`}</option>)}
            </select>
            {errors.curriculumSessionId && <span role="alert" className="text-danger">{errors.curriculumSessionId.message}</span>}
          </label>
          <label className="grid gap-1 text-sm font-medium">Trainer (optional)
            <select className={input} {...register('trainerId')}>
              <option value="">Not assigned yet</option>
              {trainerChoices.map((t) => <option key={t.trainer_id} value={t.trainer_id}>{name(t.profiles)}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">Delivery
            <select className={input} {...register('mode')}><option value="physical">In person</option><option value="online">Online</option><option value="hybrid">Hybrid</option></select>
          </label>
          <label className="grid gap-1 text-sm font-medium">Starts<input type="datetime-local" className={input} {...register('startsAt')} />{errors.startsAt && <span role="alert" className="text-danger">{errors.startsAt.message}</span>}</label>
          <label className="grid gap-1 text-sm font-medium">Ends<input type="datetime-local" className={input} {...register('endsAt')} />{errors.endsAt && <span role="alert" className="text-danger">{errors.endsAt.message}</span>}</label>
          <label className="grid gap-1 text-sm font-medium">Venue (optional)<input className={input} {...register('venue')} /></label>
          <label className="grid gap-1 text-sm font-medium">Meeting link (optional)<input className={input} placeholder="https://" {...register('meetingUrl')} />{errors.meetingUrl && <span role="alert" className="text-danger">{errors.meetingUrl.message}</span>}</label>
          <div className="sm:col-span-2"><Button type="submit" disabled={create.isPending}>Schedule session</Button></div>
          {create.isError && <p role="alert" className="text-sm text-danger sm:col-span-2">{(create.error as Error).message}</p>}
        </form>
      )}
      {d.schedules.length === 0 ? <EmptyState title="Nothing scheduled yet" />
        : (
          <ul className="divide-y divide-purple-100 rounded-card border border-purple-100">
            {d.schedules.map((s) => (
              <li key={s.id} className={`grid gap-1 p-3 text-sm ${s.status === 'cancelled' ? 'opacity-60' : ''}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{s.curriculum_sessions?.title ?? 'Session'}</span>
                  <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">{s.status}</span>
                </div>
                <span className="text-ink/70">{new Date(s.starts_at).toLocaleString()} – {new Date(s.ends_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {s.mode}{s.venue ? ` · ${s.venue}` : ''}{s.trainer_id ? ` · ${trainerName(s.trainer_id)}` : ' · no trainer yet'}</span>
                {staff && s.status === 'scheduled' && <div><Button variant="quiet" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ id: s.id, status: 'cancelled' })}>Cancel session</Button></div>}
              </li>
            ))}
          </ul>
        )}
      {setStatus.isError && <p role="alert" className="text-sm text-danger">{(setStatus.error as Error).message}</p>}
    </div>
  );
}
