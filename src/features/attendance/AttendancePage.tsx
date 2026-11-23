import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import type { AttendanceStatus } from '@/types/database';

interface ScheduleRow { id: string; cohort_id: string; starts_at: string; curriculum_sessions: { title: string } | null }
interface RosterRow { participant_id: string; participants: { participant_no: string; profiles: { first_name: string; last_name: string } | null } | null }

const STATUSES: { value: AttendanceStatus; label: string }[] = [
  { value: 'present', label: 'Present' }, { value: 'late', label: 'Late' },
  { value: 'excused', label: 'Excused' }, { value: 'absent', label: 'Absent' },
];

export function AttendancePage() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const [scheduleId, setScheduleId] = useState('');
  const [marks, setMarks] = useState<Record<string, AttendanceStatus>>({});

  const schedules = useQuery({
    queryKey: ['schedules'],
    queryFn: async () => {
      const { data, error } = await supabase.from('session_schedules')
        .select('id, cohort_id, starts_at, curriculum_sessions(title)').order('starts_at', { ascending: false }).limit(50);
      if (error) throw error;
      return data as unknown as ScheduleRow[];
    },
  });
  const selected = schedules.data?.find((s) => s.id === scheduleId);

  const roster = useQuery({
    queryKey: ['roster', selected?.cohort_id],
    enabled: Boolean(selected),
    queryFn: async () => {
      const { data, error } = await supabase.from('cohort_enrolments')
        .select('participant_id, participants(participant_no, profiles(first_name, last_name))').eq('cohort_id', selected!.cohort_id);
      if (error) throw error;
      return data as unknown as RosterRow[];
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      const rows = Object.entries(marks).map(([participant_id, status]) => ({
        schedule_id: scheduleId, participant_id, status, recorded_by: session?.user.id, updated_at: new Date().toISOString(),
      }));
      if (rows.length === 0) return;
      const { error } = await supabase.from('attendance').upsert(rows, { onConflict: 'schedule_id,participant_id' });
      if (error) throw error;
    },
    onSuccess: () => { setMarks({}); void qc.invalidateQueries({ queryKey: ['attendance'] }); },
  });

  if (schedules.isLoading) return <p role="status">Loading sessions…</p>;
  if (schedules.isError) return <p role="alert" className="text-danger">Could not load sessions. Check your connection and try again.</p>;
  if (!schedules.data?.length) return <EmptyState title="No sessions scheduled">Sessions you can record attendance for will appear here once a coordinator schedules them.</EmptyState>;

  return (
    <section className="grid max-w-3xl gap-5">
      <h1 className="text-2xl font-bold text-purple-700">Record attendance</h1>
      <label className="grid gap-1 text-sm font-medium">Session
        <select className="rounded-control border border-purple-200 px-3 py-2 font-normal" value={scheduleId} onChange={(e) => { setScheduleId(e.target.value); setMarks({}); }}>
          <option value="">Choose a session</option>
          {schedules.data.map((s) => <option key={s.id} value={s.id}>{new Date(s.starts_at).toLocaleString()} – {s.curriculum_sessions?.title ?? 'Session'}</option>)}
        </select>
      </label>
      {selected && roster.data && (roster.data.length === 0
        ? <EmptyState title="No participants enrolled in this cohort yet" />
        : (
          <div className="grid gap-3">
            <ul className="divide-y divide-purple-100 rounded-card border border-purple-100">
              {roster.data.map((r) => {
                const p = r.participants;
                return (
                  <li key={r.participant_id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <span>{p?.profiles?.first_name} {p?.profiles?.last_name} <span className="text-xs text-ink/60">{p?.participant_no}</span></span>
                    <fieldset className="flex gap-2" aria-label={`Attendance for ${p?.profiles?.first_name ?? 'participant'}`}>
                      {STATUSES.map((s) => (
                        <label key={s.value} className="flex items-center gap-1 text-sm">
                          <input type="radio" name={r.participant_id} checked={marks[r.participant_id] === s.value}
                            onChange={() => setMarks((m) => ({ ...m, [r.participant_id]: s.value }))} />{s.label}
                        </label>
                      ))}
                    </fieldset>
                  </li>
                );
              })}
            </ul>
            {save.isError && <p role="alert" className="text-sm text-danger">{(save.error as Error).message}</p>}
            {save.isSuccess && <p role="status" className="text-sm text-ok">Attendance saved.</p>}
            <Button onClick={() => save.mutate()} disabled={save.isPending || Object.keys(marks).length === 0}>Save attendance</Button>
          </div>
        ))}
    </section>
  );
}
