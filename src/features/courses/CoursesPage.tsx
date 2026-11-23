import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { Course, CourseFormat, CourseProgress } from '@/types/database';
import { FORMAT_LABEL, STATUS_LABEL, progressPercent, validateCourse } from './rules';

const field = 'rounded-control border border-purple-200 px-3 py-2 font-normal';
const BADGE = { draft: 'bg-amber-100 text-warn', published: 'bg-green-100 text-ok', archived: 'bg-slate-100 text-ink/70' } as const;

export function CoursesPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const role = profile?.role;
  const canCreate = role === 'trainer' || role === 'super_admin' || role === 'founder' || role === 'co_founder' || role === 'programme_director' || role === 'programme_coordinator';
  const isParticipant = role === 'participant';
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ programme: '', title: '', summary: '', format: 'online' as CourseFormat, track: '', cohort: '', startsOn: '', endsOn: '' });
  const [msg, setMsg] = useState<string | null>(null);

  const courses = useQuery({
    queryKey: ['courses'],
    queryFn: async () => { const { data, error } = await supabase.from('courses').select('id, programme_id, track_id, cohort_id, title, summary, format, status, starts_on, ends_on, created_at').order('created_at', { ascending: false }); if (error) throw error; return data as Course[]; },
  });
  const progress = useQuery({
    queryKey: ['course-progress-mine'], enabled: isParticipant,
    queryFn: async () => { const { data, error } = await supabase.from('v_course_progress').select('course_id, participant_id, lessons_total, lessons_done'); if (error) throw error; return data as CourseProgress[]; },
  });
  const setup = useQuery({
    queryKey: ['course-setup'], enabled: canCreate,
    queryFn: async () => {
      const [p, t, c] = await Promise.all([
        supabase.from('programmes').select('id, name').order('version', { ascending: false }),
        supabase.from('tracks').select('id, programme_id, name').order('position'),
        supabase.from('cohorts').select('id, programme_id, name').eq('archived', false).order('start_date', { ascending: false }),
      ]);
      for (const r of [p, t, c]) if (r.error) throw r.error;
      return { programmes: p.data as { id: string; name: string }[], tracks: t.data as { id: string; programme_id: string; name: string }[], cohorts: c.data as { id: string; programme_id: string; name: string }[] };
    },
  });
  const create = useMutation({
    mutationFn: async () => {
      const programme = f.programme || setup.data?.programmes[0]?.id;
      if (!programme) throw new Error('There is no programme to attach the course to.');
      const problem = validateCourse(f); if (problem) throw new Error(problem);
      const { error } = await supabase.from('courses').insert({ programme_id: programme, track_id: f.track || null, cohort_id: f.cohort || null, title: f.title.trim(), summary: f.summary.trim() || null, format: f.format, starts_on: f.startsOn || null, ends_on: f.endsOn || null });
      if (error) throw error;
    },
    onSuccess: () => { setOpen(false); setMsg(null); setF({ ...f, title: '', summary: '' }); void qc.invalidateQueries({ queryKey: ['courses'] }); },
    onError: (e: Error) => setMsg(e.message),
  });

  if (courses.isLoading) return <p role="status">Loading…</p>;
  if (courses.isError) return <p role="alert" className="text-danger">Could not load courses.</p>;
  const programmeId = f.programme || setup.data?.programmes[0]?.id || '';
  const list = (courses.data ?? []).filter((c) => showArchived || c.status !== 'archived');
  const pOf = (id: string) => progress.data?.find((p) => p.course_id === id);

  return (
    <section className="grid max-w-5xl gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-purple-700">{isParticipant ? 'My courses' : 'Courses'}</h1>
        <div className="flex items-center gap-3">
          {!isParticipant && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} /> Show archived</label>}
          {canCreate && <Button type="button" onClick={() => setOpen(!open)}>{open ? 'Close' : 'New course'}</Button>}
        </div>
      </div>
      {open && setup.data && (
        <form className="grid gap-3 rounded-card border border-purple-100 p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <h2 className="font-display text-lg font-semibold sm:col-span-2">New course (starts as a draft)</h2>
          <label className="grid gap-1 text-sm font-medium sm:col-span-2">Title<input value={f.title} maxLength={160} onChange={(e) => setF({ ...f, title: e.target.value })} className={field} /></label>
          <label className="grid gap-1 text-sm font-medium sm:col-span-2">Summary<textarea rows={3} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} className={field} /></label>
          <label className="grid gap-1 text-sm font-medium">Programme<select value={programmeId} onChange={(e) => setF({ ...f, programme: e.target.value, track: '', cohort: '' })} className={field}>{setup.data.programmes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="grid gap-1 text-sm font-medium">Format<select value={f.format} onChange={(e) => setF({ ...f, format: e.target.value as CourseFormat })} className={field}>{(Object.keys(FORMAT_LABEL) as CourseFormat[]).map((k) => <option key={k} value={k}>{FORMAT_LABEL[k]}</option>)}</select></label>
          <label className="grid gap-1 text-sm font-medium">Only for one track <span className="font-normal text-ink/60">(optional)</span><select value={f.track} onChange={(e) => setF({ ...f, track: e.target.value })} className={field}><option value="">All tracks</option>{setup.data.tracks.filter((t) => t.programme_id === programmeId).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label className="grid gap-1 text-sm font-medium">Only for one cohort <span className="font-normal text-ink/60">(optional)</span><select value={f.cohort} onChange={(e) => setF({ ...f, cohort: e.target.value })} className={field}><option value="">Any cohort</option>{setup.data.cohorts.filter((c) => c.programme_id === programmeId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <label className="grid gap-1 text-sm font-medium">Starts <span className="font-normal text-ink/60">(optional)</span><input type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} className={field} /></label>
          <label className="grid gap-1 text-sm font-medium">Ends <span className="font-normal text-ink/60">(optional)</span><input type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} className={field} /></label>
          {msg && <p role="alert" className="text-sm text-danger sm:col-span-2">{msg}</p>}
          <Button type="submit" disabled={create.isPending} className="justify-self-start">Create course</Button>
        </form>
      )}
      {!list.length ? <EmptyState title="No courses yet">{isParticipant ? 'When the programme team enrols you in a course it appears here.' : canCreate ? 'Create the first course above.' : 'Courses appear here once they exist.'}</EmptyState> : (
        <ul className="grid gap-3 md:grid-cols-2">
          {list.map((c) => {
            const pr = pOf(c.id); const pct = pr ? progressPercent(pr.lessons_done, pr.lessons_total) : null;
            return (
              <li key={c.id} className="rounded-card border border-purple-100 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <h2 className="font-display text-lg font-semibold"><Link to={`/courses/${c.id}`} className="text-purple-700 underline">{c.title}</Link></h2>
                  {!isParticipant && <span className={`rounded-full px-3 py-1 text-xs font-semibold ${BADGE[c.status]}`}>{STATUS_LABEL[c.status]}</span>}
                </div>
                <p className="text-sm text-ink/70">{FORMAT_LABEL[c.format]}{c.starts_on ? ` · ${c.starts_on}${c.ends_on ? ` to ${c.ends_on}` : ''}` : ''}</p>
                {c.summary && <p className="mt-2 line-clamp-3 text-sm">{c.summary}</p>}
                {isParticipant && pr && (
                  <div className="mt-3" aria-label={`Progress ${pct ?? 0}%`}>
                    <div className="h-2 overflow-hidden rounded-full bg-purple-100"><div className="h-2 bg-purple-600" style={{ width: `${pct ?? 0}%` }} /></div>
                    <p className="mt-1 text-xs text-ink/70">{pct === null ? 'No lessons yet' : `${pr.lessons_done} of ${pr.lessons_total} lessons done (${pct}%)`}</p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
