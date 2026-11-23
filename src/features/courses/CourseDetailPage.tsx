import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { FILE_NOT_AVAILABLE } from '@/lib/files';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { Course, CourseLesson, CourseModule, CourseProgress, CourseStatus, LessonKind } from '@/types/database';
import { FORMAT_LABEL, KIND_LABEL, STATUS_LABEL, courseAbilities, materialPath, moveItem, progressPercent, validateCourse, validateLesson } from './rules';

interface Person { first_name: string; last_name: string }
const nameOf = (p: Person | null | undefined) => (p ? `${p.first_name} ${p.last_name}`.trim() || 'Unnamed' : 'Unnamed');
const field = 'rounded-control border border-purple-200 px-3 py-2 font-normal';
const BUCKET = 'course-materials';

export function CourseDetailPage() {
  const { courseId = '' } = useParams();
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const refresh = () => { setError(null); void qc.invalidateQueries({ queryKey: ['course', courseId] }); void qc.invalidateQueries({ queryKey: ['courses'] }); void qc.invalidateQueries({ queryKey: ['course-progress-mine'] }); };
  const fail = (e: Error) => setError(e.message);
  const isParticipant = profile?.role === 'participant';

  const data = useQuery({
    queryKey: ['course', courseId],
    queryFn: async () => {
      const [c, m, t, e, pr] = await Promise.all([
        supabase.from('courses').select('id, programme_id, track_id, cohort_id, title, summary, format, status, starts_on, ends_on, created_at').eq('id', courseId).maybeSingle(),
        supabase.from('course_modules').select('id, course_id, position, title, description').eq('course_id', courseId).order('position').order('created_at'),
        supabase.from('course_trainers').select('trainer_id, profiles(first_name, last_name)').eq('course_id', courseId),
        supabase.from('course_enrolments').select('participant_id, participants(participant_no, profiles(first_name, last_name))').eq('course_id', courseId),
        supabase.from('v_course_progress').select('course_id, participant_id, lessons_total, lessons_done').eq('course_id', courseId),
      ]);
      for (const r of [c, m, t, e, pr]) if (r.error) throw r.error;
      const modules = m.data as CourseModule[];
      const lessons = modules.length ? await supabase.from('course_lessons').select('id, module_id, position, title, kind, body, storage_path, external_url, mime_type, duration_minutes').in('module_id', modules.map((x) => x.id)).order('position').order('created_at') : { data: [] as CourseLesson[], error: null };
      if (lessons.error) throw lessons.error;
      const done = isParticipant && lessons.data?.length ? await supabase.from('lesson_progress').select('lesson_id').in('lesson_id', (lessons.data as CourseLesson[]).map((l) => l.id)) : { data: [] as { lesson_id: string }[], error: null };
      if (done.error) throw done.error;
      return {
        course: c.data as Course | null, modules, lessons: (lessons.data ?? []) as CourseLesson[],
        trainers: t.data as unknown as { trainer_id: string; profiles: Person | null }[],
        enrolments: e.data as unknown as { participant_id: string; participants: { participant_no: string; profiles: Person | null } | null }[],
        progress: pr.data as CourseProgress[], doneIds: new Set((done.data ?? []).map((d) => d.lesson_id)),
      };
    },
  });

  const open = async (l: CourseLesson) => {
    if (l.storage_path) {
      const { data: s, error: e } = await supabase.storage.from(BUCKET).createSignedUrl(l.storage_path, 120);
      if (e || !s) { setError(FILE_NOT_AVAILABLE); return; }
      window.open(s.signedUrl, '_blank', 'noopener,noreferrer');
    } else if (l.external_url) window.open(l.external_url, '_blank', 'noopener,noreferrer');
  };

  const toggleDone = useMutation({
    mutationFn: async (v: { lessonId: string; done: boolean }) => {
      const pid = (await supabase.from('participants').select('id').maybeSingle()).data as { id: string } | null;
      if (!pid) throw new Error('Your participant record was not found.');
      const res = v.done ? await supabase.from('lesson_progress').delete().eq('lesson_id', v.lessonId).eq('participant_id', pid.id) : await supabase.from('lesson_progress').insert({ lesson_id: v.lessonId, participant_id: pid.id });
      if (res.error) throw res.error;
    }, onSuccess: refresh, onError: fail,
  });

  if (data.isLoading) return <p role="status">Loading…</p>;
  if (data.isError) return <p role="alert" className="text-danger">Could not load this course.</p>;
  const d = data.data!;
  if (!d.course) return <EmptyState title="Course not found">It may have been removed, or you may not have access to it. <Link to="/courses" className="underline">Back to courses</Link></EmptyState>;
  const course = d.course;
  const assigned = d.trainers.some((t) => t.trainer_id === profile?.id);
  const { manage, editContent } = courseAbilities(profile?.role, assigned);
  const myProgress = d.progress[0];
  const pct = isParticipant && myProgress ? progressPercent(myProgress.lessons_done, myProgress.lessons_total) : null;

  return (
    <section className="grid max-w-4xl gap-6">
      <p><Link to="/courses" className="text-sm text-purple-700 underline">‹ All courses</Link></p>
      <CourseHeader course={course} manage={manage} editContent={editContent} lessonCount={d.lessons.length} onChanged={refresh} onError={fail} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {isParticipant && (
        <div aria-label={`Your progress ${pct ?? 0}%`}>
          <div className="h-3 overflow-hidden rounded-full bg-purple-100"><div className="h-3 bg-purple-600" style={{ width: `${pct ?? 0}%` }} /></div>
          <p className="mt-1 text-sm text-ink/70">{pct === null ? 'No lessons yet' : `${myProgress!.lessons_done} of ${myProgress!.lessons_total} lessons done (${pct}%)`}</p>
        </div>
      )}

      <div className="grid gap-4">
        <h2 className="font-display text-xl font-semibold">Course content</h2>
        {!d.modules.length && <p className="text-sm text-ink/70">{editContent ? 'Add the first module below.' : 'No content has been added yet.'}</p>}
        {d.modules.map((m, mi) => (
          <ModuleBlock key={m.id} courseId={courseId} module={m} index={mi} modules={d.modules} lessons={d.lessons.filter((l) => l.module_id === m.id)}
            editContent={editContent} isParticipant={isParticipant} doneIds={d.doneIds} onOpen={(l) => void open(l)} onToggle={(lessonId, done) => toggleDone.mutate({ lessonId, done })} onChanged={refresh} onError={fail} />
        ))}
        {editContent && <AddModule courseId={courseId} next={d.modules.length} onChanged={refresh} onError={fail} />}
      </div>

      {!isParticipant && <Trainers courseId={courseId} trainers={d.trainers} manage={manage} onChanged={refresh} onError={fail} />}
      {!isParticipant && <Enrolments course={course} enrolments={d.enrolments} progress={d.progress} manage={manage} onChanged={refresh} onError={fail} />}
    </section>
  );
}

function CourseHeader({ course, manage, editContent, lessonCount, onChanged, onError }: { course: Course; manage: boolean; editContent: boolean; lessonCount: number; onChanged: () => void; onError: (e: Error) => void }) {
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ title: course.title, summary: course.summary ?? '', format: course.format, startsOn: course.starts_on ?? '', endsOn: course.ends_on ?? '' });
  const save = useMutation({
    mutationFn: async () => { const p = validateCourse(f); if (p) throw new Error(p); const { error } = await supabase.from('courses').update({ title: f.title.trim(), summary: f.summary.trim() || null, format: f.format, starts_on: f.startsOn || null, ends_on: f.endsOn || null }).eq('id', course.id); if (error) throw error; },
    onSuccess: () => { setEditing(false); onChanged(); }, onError,
  });
  const setStatus = useMutation({
    mutationFn: async (status: CourseStatus) => { const { error } = await supabase.from('courses').update({ status }).eq('id', course.id); if (error) throw error; },
    onSuccess: onChanged, onError,
  });
  if (editing) {
    return (
      <form className="grid gap-3 rounded-card border border-purple-100 p-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <label className="grid gap-1 text-sm font-medium">Title<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className={field} /></label>
        <label className="grid gap-1 text-sm font-medium">Summary<textarea rows={3} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} className={field} /></label>
        <label className="grid max-w-xs gap-1 text-sm font-medium">Format<select value={f.format} onChange={(e) => setF({ ...f, format: e.target.value as Course['format'] })} className={field}>{(Object.keys(FORMAT_LABEL) as Course['format'][]).map((k) => <option key={k} value={k}>{FORMAT_LABEL[k]}</option>)}</select></label>
        <div className="flex flex-wrap gap-3"><label className="grid gap-1 text-sm font-medium">Starts<input type="date" value={f.startsOn} onChange={(e) => setF({ ...f, startsOn: e.target.value })} className={field} /></label><label className="grid gap-1 text-sm font-medium">Ends<input type="date" value={f.endsOn} onChange={(e) => setF({ ...f, endsOn: e.target.value })} className={field} /></label></div>
        <div className="flex gap-2"><Button type="submit" disabled={save.isPending}>Save</Button><Button type="button" variant="quiet" onClick={() => setEditing(false)}>Cancel</Button></div>
      </form>
    );
  }
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h1 className="text-2xl font-bold text-purple-700">{course.title}</h1>
        {editContent && <span className="rounded-full bg-purple-50 px-3 py-1 text-xs font-semibold text-purple-700">{STATUS_LABEL[course.status]}</span>}
      </div>
      <p className="text-sm text-ink/70">{FORMAT_LABEL[course.format]}{course.starts_on ? ` · ${course.starts_on}${course.ends_on ? ` to ${course.ends_on}` : ''}` : ''}</p>
      {course.summary && <p className="whitespace-pre-wrap">{course.summary}</p>}
      {editContent && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="quiet" onClick={() => setEditing(true)}>Edit details</Button>
          {manage && course.status === 'draft' && <Button type="button" disabled={setStatus.isPending || lessonCount === 0} onClick={() => setStatus.mutate('published')}>Publish</Button>}
          {manage && course.status === 'published' && <Button type="button" variant="quiet" onClick={() => setStatus.mutate('draft')}>Unpublish</Button>}
          {manage && course.status !== 'archived' && <Button type="button" variant="quiet" onClick={() => { if (window.confirm('Archive this course? Participants will no longer see it.')) setStatus.mutate('archived'); }}>Archive</Button>}
          {manage && course.status === 'archived' && <Button type="button" variant="quiet" onClick={() => setStatus.mutate('draft')}>Restore as draft</Button>}
        </div>
      )}
      {editContent && !manage && <p className="text-xs text-ink/60">Only programme management can publish or archive a course.</p>}
      {manage && course.status === 'draft' && lessonCount === 0 && <p className="text-xs text-ink/60">Add at least one lesson before publishing.</p>}
    </div>
  );
}

function AddModule({ courseId, next, onChanged, onError }: { courseId: string; next: number; onChanged: () => void; onError: (e: Error) => void }) {
  const [title, setTitle] = useState(''); const [description, setDescription] = useState('');
  const add = useMutation({
    mutationFn: async () => { if (title.trim().length < 2) throw new Error('Give the module a title.'); const { error } = await supabase.from('course_modules').insert({ course_id: courseId, position: next, title: title.trim(), description: description.trim() || null }); if (error) throw error; },
    onSuccess: () => { setTitle(''); setDescription(''); onChanged(); }, onError,
  });
  return (
    <form className="grid gap-2 rounded-card border border-dashed border-purple-200 p-4" onSubmit={(e) => { e.preventDefault(); add.mutate(); }}>
      <h3 className="font-display text-base font-semibold">Add a module</h3>
      <label className="grid gap-1 text-sm font-medium">Title<input value={title} onChange={(e) => setTitle(e.target.value)} className={field} /></label>
      <label className="grid gap-1 text-sm font-medium">Description <span className="font-normal text-ink/60">(optional)</span><input value={description} onChange={(e) => setDescription(e.target.value)} className={field} /></label>
      <Button type="submit" disabled={add.isPending} className="justify-self-start">Add module</Button>
    </form>
  );
}

function ModuleBlock({ courseId, module: m, index, modules, lessons, editContent, isParticipant, doneIds, onOpen, onToggle, onChanged, onError }: {
  courseId: string; module: CourseModule; index: number; modules: CourseModule[]; lessons: CourseLesson[]; editContent: boolean; isParticipant: boolean; doneIds: Set<string>;
  onOpen: (l: CourseLesson) => void; onToggle: (lessonId: string, done: boolean) => void; onChanged: () => void; onError: (e: Error) => void;
}) {
  const [reading, setReading] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const reorderModules = useMutation({
    mutationFn: async (dir: -1 | 1) => { const order = moveItem(modules, index, dir); await Promise.all(order.map((x, i) => supabase.from('course_modules').update({ position: i }).eq('id', x.id).then((r) => { if (r.error) throw r.error; }))); },
    onSuccess: onChanged, onError,
  });
  const reorderLessons = useMutation({
    mutationFn: async (v: { i: number; dir: -1 | 1 }) => { const order = moveItem(lessons, v.i, v.dir); await Promise.all(order.map((x, i) => supabase.from('course_lessons').update({ position: i }).eq('id', x.id).then((r) => { if (r.error) throw r.error; }))); },
    onSuccess: onChanged, onError,
  });
  const delModule = useMutation({
    mutationFn: async () => {
      const paths = lessons.map((l) => l.storage_path).filter((p): p is string => Boolean(p));
      const { error } = await supabase.from('course_modules').delete().eq('id', m.id); if (error) throw error;
      if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
    }, onSuccess: onChanged, onError,
  });
  const delLesson = useMutation({
    mutationFn: async (l: CourseLesson) => { const { error } = await supabase.from('course_lessons').delete().eq('id', l.id); if (error) throw error; if (l.storage_path) await supabase.storage.from(BUCKET).remove([l.storage_path]); },
    onSuccess: onChanged, onError,
  });

  return (
    <article className="rounded-card border border-purple-100 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div><h3 className="font-display text-lg font-semibold">{index + 1}. {m.title}</h3>{m.description && <p className="text-sm text-ink/70">{m.description}</p>}</div>
        {editContent && (
          <div className="flex flex-wrap gap-1">
            <Button type="button" variant="quiet" aria-label={`Move ${m.title} up`} disabled={index === 0 || reorderModules.isPending} onClick={() => reorderModules.mutate(-1)}>↑</Button>
            <Button type="button" variant="quiet" aria-label={`Move ${m.title} down`} disabled={index === modules.length - 1 || reorderModules.isPending} onClick={() => reorderModules.mutate(1)}>↓</Button>
            <Button type="button" variant="quiet" onClick={() => { if (window.confirm(`Delete the module "${m.title}" and its ${lessons.length} lessons?`)) delModule.mutate(); }}>Delete</Button>
          </div>
        )}
      </div>
      {!lessons.length && <p className="mt-2 text-sm text-ink/60">No lessons in this module yet.</p>}
      <ul className="mt-3 grid gap-2">
        {lessons.map((l, i) => {
          const done = doneIds.has(l.id);
          return (
            <li key={l.id} className="rounded-control border border-purple-100 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {isParticipant && <input type="checkbox" checked={done} aria-label={`Mark "${l.title}" ${done ? 'not done' : 'done'}`} onChange={() => onToggle(l.id, done)} />}
                  <span className="font-medium">{l.title}</span><span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs">{KIND_LABEL[l.kind]}</span>
                  {l.duration_minutes && <span className="text-xs text-ink/60">{l.duration_minutes} min</span>}
                </div>
                <div className="flex flex-wrap gap-1">
                  {l.kind === 'reading' ? <Button type="button" variant="quiet" onClick={() => setReading(reading === l.id ? null : l.id)}>{reading === l.id ? 'Hide' : 'Read'}</Button> : <Button type="button" variant="quiet" onClick={() => onOpen(l)}>Open</Button>}
                  {editContent && <>
                    <Button type="button" variant="quiet" aria-label={`Move ${l.title} up`} disabled={i === 0} onClick={() => reorderLessons.mutate({ i, dir: -1 })}>↑</Button>
                    <Button type="button" variant="quiet" aria-label={`Move ${l.title} down`} disabled={i === lessons.length - 1} onClick={() => reorderLessons.mutate({ i, dir: 1 })}>↓</Button>
                    <Button type="button" variant="quiet" onClick={() => { if (window.confirm(`Delete "${l.title}"?`)) delLesson.mutate(l); }}>Delete</Button>
                  </>}
                </div>
              </div>
              {l.kind === 'reading' && reading === l.id && <p className="mt-2 whitespace-pre-wrap">{l.body}</p>}
            </li>
          );
        })}
      </ul>
      {editContent && (adding
        ? <AddLesson courseId={courseId} moduleId={m.id} next={lessons.length} onDone={() => { setAdding(false); onChanged(); }} onCancel={() => setAdding(false)} onError={onError} />
        : <Button type="button" variant="quiet" className="mt-3" onClick={() => setAdding(true)}>Add a lesson</Button>)}
    </article>
  );
}

function AddLesson({ courseId, moduleId, next, onDone, onCancel, onError }: { courseId: string; moduleId: string; next: number; onDone: () => void; onCancel: () => void; onError: (e: Error) => void }) {
  const [f, setF] = useState({ title: '', kind: 'reading' as LessonKind, body: '', externalUrl: '', minutes: '' });
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: async () => {
      const problem = validateLesson({ title: f.title, kind: f.kind, body: f.body, externalUrl: f.externalUrl, file: file ? { type: file.type, size: file.size } : null }); if (problem) throw new Error(problem);
      const minutes = f.minutes.trim() ? Number(f.minutes) : null;
      if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1 || minutes > 600)) throw new Error('Minutes must be a whole number from 1 to 600.');
      let path: string | null = null;
      if (file && (f.kind === 'pdf' || f.kind === 'presentation' || f.kind === 'video')) {
        path = materialPath(courseId, file.name, Date.now());
        const up = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type }); if (up.error) throw up.error;
      }
      const { error } = await supabase.from('course_lessons').insert({ module_id: moduleId, position: next, title: f.title.trim(), kind: f.kind, body: f.kind === 'reading' ? f.body.trim() : null, storage_path: path, mime_type: file?.type ?? null,
        external_url: f.kind === 'reading' ? null : f.externalUrl.trim() || null, duration_minutes: minutes });
      if (error) { if (path) await supabase.storage.from(BUCKET).remove([path]); throw error; }
    },
    onSuccess: onDone, onError: (e: Error) => { setMsg(e.message); onError(e); },
  });
  const fileKind = f.kind === 'pdf' || f.kind === 'presentation' || f.kind === 'video';
  return (
    <form className="mt-3 grid gap-2 rounded-control bg-purple-50 p-3" onSubmit={(e) => { e.preventDefault(); setMsg(null); add.mutate(); }}>
      <label className="grid gap-1 text-sm font-medium">Lesson title<input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} className={field} /></label>
      <label className="grid max-w-xs gap-1 text-sm font-medium">Type<select value={f.kind} onChange={(e) => { setF({ ...f, kind: e.target.value as LessonKind }); setFile(null); }} className={field}>{(Object.keys(KIND_LABEL) as LessonKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></label>
      {f.kind === 'reading' && <label className="grid gap-1 text-sm font-medium">Text<textarea rows={6} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} className={field} /></label>}
      {fileKind && <label className="grid gap-1 text-sm font-medium">File (up to 50 MB)<input type="file" accept={f.kind === 'pdf' ? '.pdf' : f.kind === 'presentation' ? '.pptx,.ppt' : '.mp4'} onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>}
      {f.kind !== 'reading' && <label className="grid gap-1 text-sm font-medium">{fileKind ? 'Or a link instead of a file' : 'Web address'}<input inputMode="url" placeholder="https://" value={f.externalUrl} onChange={(e) => setF({ ...f, externalUrl: e.target.value })} className={field} /></label>}
      <label className="grid max-w-[10rem] gap-1 text-sm font-medium">Minutes <span className="font-normal text-ink/60">(optional)</span><input inputMode="numeric" value={f.minutes} onChange={(e) => setF({ ...f, minutes: e.target.value })} className={field} /></label>
      {msg && <p role="alert" className="text-sm text-danger">{msg}</p>}
      <div className="flex gap-2"><Button type="submit" disabled={add.isPending}>{add.isPending ? 'Saving…' : 'Add lesson'}</Button><Button type="button" variant="quiet" onClick={onCancel}>Cancel</Button></div>
    </form>
  );
}

function Trainers({ courseId, trainers, manage, onChanged, onError }: { courseId: string; trainers: { trainer_id: string; profiles: Person | null }[]; manage: boolean; onChanged: () => void; onError: (e: Error) => void }) {
  const [pick, setPick] = useState('');
  const all = useQuery({
    queryKey: ['active-trainers'], enabled: manage,
    queryFn: async () => { const { data, error } = await supabase.from('profiles').select('id, first_name, last_name').eq('role', 'trainer').eq('status', 'active'); if (error) throw error; return data as { id: string; first_name: string; last_name: string }[]; },
  });
  const add = useMutation({ mutationFn: async () => { const { error } = await supabase.from('course_trainers').insert({ course_id: courseId, trainer_id: pick }); if (error) throw error; }, onSuccess: () => { setPick(''); onChanged(); }, onError });
  const remove = useMutation({ mutationFn: async (id: string) => { const { error } = await supabase.from('course_trainers').delete().eq('course_id', courseId).eq('trainer_id', id); if (error) throw error; }, onSuccess: onChanged, onError });
  const free = (all.data ?? []).filter((t) => !trainers.some((x) => x.trainer_id === t.id));
  return (
    <div className="grid gap-2">
      <h2 className="font-display text-xl font-semibold">Trainers</h2>
      {!trainers.length && <p className="text-sm text-ink/70">No trainer assigned yet.</p>}
      <ul className="grid gap-1 text-sm">{trainers.map((t) => <li key={t.trainer_id} className="flex items-center gap-3">{nameOf(t.profiles)}{manage && <Button type="button" variant="quiet" onClick={() => remove.mutate(t.trainer_id)}>Remove</Button>}</li>)}</ul>
      {manage && <div className="flex flex-wrap items-end gap-2"><label className="grid gap-1 text-sm font-medium">Assign a trainer<select value={pick} onChange={(e) => setPick(e.target.value)} className={field}><option value="">Choose</option>{free.map((t) => <option key={t.id} value={t.id}>{nameOf(t)}</option>)}</select></label><Button type="button" disabled={!pick || add.isPending} onClick={() => add.mutate()}>Assign</Button></div>}
    </div>
  );
}

function Enrolments({ course, enrolments, progress, manage, onChanged, onError }: { course: Course; enrolments: { participant_id: string; participants: { participant_no: string; profiles: Person | null } | null }[]; progress: CourseProgress[]; manage: boolean; onChanged: () => void; onError: (e: Error) => void }) {
  const [pick, setPick] = useState('');
  const candidates = useQuery({
    queryKey: ['course-candidates', course.id, course.cohort_id], enabled: manage,
    queryFn: async () => {
      if (course.cohort_id) { const { data, error } = await supabase.from('cohort_enrolments').select('participant_id, participants(participant_no, status, profiles(first_name, last_name))').eq('cohort_id', course.cohort_id); if (error) throw error; return (data as unknown as { participant_id: string; participants: { participant_no: string; status: string; profiles: Person | null } | null }[]).map((x) => ({ id: x.participant_id, no: x.participants?.participant_no ?? '', status: x.participants?.status ?? '', person: x.participants?.profiles ?? null })); }
      const { data, error } = await supabase.from('participants').select('id, participant_no, status, profiles(first_name, last_name)'); if (error) throw error;
      return (data as unknown as { id: string; participant_no: string; status: string; profiles: Person | null }[]).map((x) => ({ id: x.id, no: x.participant_no, status: x.status, person: x.profiles }));
    },
  });
  const enrol = useMutation({ mutationFn: async () => { const { error } = await supabase.from('course_enrolments').insert({ course_id: course.id, participant_id: pick }); if (error) throw error; }, onSuccess: () => { setPick(''); onChanged(); }, onError });
  const remove = useMutation({ mutationFn: async (id: string) => { const { error } = await supabase.from('course_enrolments').delete().eq('course_id', course.id).eq('participant_id', id); if (error) throw error; }, onSuccess: onChanged, onError });
  const free = useMemo(() => (candidates.data ?? []).filter((c) => c.status !== 'withdrawn' && !enrolments.some((e) => e.participant_id === c.id)), [candidates.data, enrolments]);
  return (
    <div className="grid gap-2">
      <h2 className="font-display text-xl font-semibold">Participants</h2>
      {manage && <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm font-medium">Enrol a participant{course.cohort_id ? ' (from the course cohort)' : course.track_id ? ' (must be on this track)' : ''}
          <select value={pick} onChange={(e) => setPick(e.target.value)} className={field}><option value="">Choose</option>{free.map((c) => <option key={c.id} value={c.id}>{nameOf(c.person)} ({c.no})</option>)}</select></label>
        <Button type="button" disabled={!pick || enrol.isPending} onClick={() => enrol.mutate()}>Enrol</Button>
      </div>}
      {!enrolments.length ? <p className="text-sm text-ink/70">Nobody is enrolled yet.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm"><caption className="sr-only">Enrolled participants and progress</caption>
            <thead><tr className="border-b border-purple-200"><th scope="col" className="p-2">Participant</th><th scope="col" className="p-2">Progress</th><th scope="col" className="p-2"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{enrolments.map((e) => {
              const p = progress.find((x) => x.participant_id === e.participant_id); const pct = p ? progressPercent(p.lessons_done, p.lessons_total) : null;
              return (
                <tr key={e.participant_id} className="border-b border-purple-100">
                  <th scope="row" className="p-2 font-medium">{nameOf(e.participants?.profiles)}<div className="text-xs font-normal text-ink/60">{e.participants?.participant_no}</div></th>
                  <td className="p-2">{p && pct !== null ? `${p.lessons_done} of ${p.lessons_total} lessons (${pct}%)` : 'No lessons yet'}</td>
                  <td className="p-2">{manage && <Button type="button" variant="quiet" onClick={() => { if (window.confirm('Remove this participant from the course? Their lesson progress is kept.')) remove.mutate(e.participant_id); }}>Remove</Button>}</td>
                </tr>);
            })}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
