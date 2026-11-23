import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import type { CurriculumSession, Track } from '@/types/database';
import { arrayToLines, canApproveCurriculum, canEditCurriculum, linesToArray, sessionNumberTaken, validateSessionDraft, type SessionDraft } from './adminRules';
import { groupByTrack } from './CurriculumPage';
import { canApproveLessonPlan } from './lessonPlan';

const field = 'rounded-control border border-purple-200 px-3 py-2 font-normal';
const blank: SessionDraft = { title: '', description: '', weekNo: 2, sessionNo: 3, durationMinutes: 120, objectives: '', activities: '', topics: '', expectedOutput: '', assessmentNotes: '' };
const toDraft = (s: CurriculumSession & { assessment_notes?: string | null }): SessionDraft => ({
  title: s.title, description: s.description ?? '', weekNo: s.week_no, sessionNo: s.session_no, durationMinutes: s.duration_minutes,
  objectives: arrayToLines(s.objectives), activities: arrayToLines(s.activities), topics: arrayToLines(s.topics),
  expectedOutput: s.expected_output ?? '', assessmentNotes: s.assessment_notes ?? '',
});

type Editing = { mode: 'new'; trackId: string | null } | { mode: 'edit'; session: CurriculumSession };

export function CurriculumAdminPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Editing | null>(null);
  const canEdit = profile ? canEditCurriculum(profile.role) : false;
  const canApprove = profile ? canApproveCurriculum(profile.role) : false;
  const canApprovePlans = profile ? canApproveLessonPlan(profile.role) : false;

  const q = useQuery({
    queryKey: ['curriculum-admin'],
    queryFn: async () => {
      const [t, s, p, lp] = await Promise.all([
        supabase.from('tracks').select('id, code, name, focus, position, programme_id').order('position'),
        supabase.from('curriculum_sessions').select('*').order('session_no'),
        supabase.from('programmes').select('id').limit(1).single(),
        supabase.from('curriculum_lesson_plans').select('session_id, status, version'),
      ]);
      if (t.error) throw t.error;
      if (s.error) throw s.error;
      if (p.error) throw p.error;
      // Lesson plan status is extra information: if it cannot be read the page still works.
      const plans = new Map<string, { status: 'draft' | 'approved'; version: string }>();
      if (!lp.error) for (const r of lp.data as { session_id: string; status: 'draft' | 'approved'; version: string }[]) plans.set(r.session_id, r);
      return { sessions: s.data as CurriculumSession[], tracks: t.data as Track[], programmeId: (p.data as { id: string }).id, plans };
    },
  });
  const approve = useMutation({
    mutationFn: async ({ id, approved }: { id: string; approved: boolean }) => {
      const { error } = await supabase.rpc('set_curriculum_approval', { p_session: id, p_approved: approved });
      if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['curriculum-admin'] }); void qc.invalidateQueries({ queryKey: ['curriculum'] }); },
  });
  const approvePlan = useMutation({
    mutationFn: async ({ id, approved }: { id: string; approved: boolean }) => {
      const { error } = await supabase.rpc('set_lesson_plan_approval', { p_session: id, p_approved: approved });
      if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['curriculum-admin'] }); void qc.invalidateQueries({ queryKey: ['lesson-plan'] }); },
  });

  if (q.isLoading) return <p role="status">Loading curriculum…</p>;
  if (q.isError) return <p role="alert" className="text-danger">Could not load the curriculum.</p>;
  const { sessions, tracks, programmeId, plans } = q.data!;
  const { core, perTrack } = groupByTrack(sessions, tracks);
  const groups = [{ id: null as string | null, name: 'Shared core', items: core }, ...perTrack.map((g) => ({ id: g.track.id as string | null, name: g.track.name, items: g.sessions }))];

  return (
    <section className="grid max-w-4xl gap-8">
      <div>
        <h1 className="text-2xl font-bold text-purple-700">Manage curriculum</h1>
        <p className="mt-1 text-sm text-ink/70">
          {canEdit ? 'Edits to approved content send it back to draft until the programme director or a super administrator approves it again.' : 'You can review the curriculum here. Editing is for coordinators and super administrators.'}
        </p>
      </div>
      {approve.isError && <p role="alert" className="text-sm text-danger">{(approve.error as Error).message}</p>}
      {approvePlan.isError && <p role="alert" className="text-sm text-danger">{(approvePlan.error as Error).message}</p>}
      {editing && (
        <SessionEditor key={editing.mode === 'edit' ? editing.session.id : `new-${editing.trackId}`} editing={editing} programmeId={programmeId} all={sessions}
          onDone={() => { setEditing(null); void qc.invalidateQueries({ queryKey: ['curriculum-admin'] }); void qc.invalidateQueries({ queryKey: ['curriculum'] }); }} onCancel={() => setEditing(null)} />
      )}
      {groups.map((g) => (
        <div key={g.id ?? 'core'} className="grid gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-xl font-semibold text-purple-900">{g.name}</h2>
            {canEdit && <Button variant="quiet" onClick={() => setEditing({ mode: 'new', trackId: g.id })}>Add session</Button>}
          </div>
          {g.items.length === 0 ? <EmptyState title="No sessions yet" /> : (
            <ul className="divide-y divide-purple-100 rounded-card border border-purple-100">
              {g.items.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span>
                    <span className="block font-medium">Session {s.session_no}: {s.title}</span>
                    <span className="text-xs text-ink/60">Week {s.week_no} · {s.duration_minutes} min · {s.topics.length > 0 ? `${s.topics.length} proposed topics · ` : ''}source: {s.source}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${s.is_approved ? 'bg-ok/10 text-ok' : 'bg-orange-50 text-warn'}`}>{s.is_approved ? 'Approved' : 'Draft'}</span>
                    {canApprove && <Button variant="quiet" disabled={approve.isPending} onClick={() => approve.mutate({ id: s.id, approved: !s.is_approved })}>{s.is_approved ? 'Withdraw approval' : 'Approve'}</Button>}
                    {plans.get(s.id) && (
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${plans.get(s.id)!.status === 'approved' ? 'bg-ok/10 text-ok' : 'bg-orange-50 text-warn'}`}>
                        Lesson plan {plans.get(s.id)!.version}: {plans.get(s.id)!.status === 'approved' ? 'approved' : 'draft'}
                      </span>
                    )}
                    {canApprovePlans && plans.get(s.id) && (
                      <Button variant="quiet" disabled={approvePlan.isPending} onClick={() => approvePlan.mutate({ id: s.id, approved: plans.get(s.id)!.status !== 'approved' })}>
                        {plans.get(s.id)!.status === 'approved' ? 'Withdraw lesson plan approval' : 'Approve lesson plan'}
                      </Button>
                    )}
                    {canEdit && <Button variant="quiet" onClick={() => setEditing({ mode: 'edit', session: s })}>Edit</Button>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}

function SessionEditor({ editing, programmeId, all, onDone, onCancel }: { editing: Editing; programmeId: string; all: CurriculumSession[]; onDone: () => void; onCancel: () => void }) {
  const isEdit = editing.mode === 'edit';
  const trackId = isEdit ? editing.session.track_id : editing.trackId;
  const [d, setD] = useState<SessionDraft>(isEdit ? toDraft(editing.session) : blank);
  const [errs, setErrs] = useState<Partial<Record<keyof SessionDraft, string>>>({});
  const set = <K extends keyof SessionDraft>(k: K, v: SessionDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      const e = validateSessionDraft(d);
      if (sessionNumberTaken(all, trackId, d.sessionNo, isEdit ? editing.session.id : undefined)) e.sessionNo = 'Another session in this group already uses that number';
      setErrs(e);
      if (Object.keys(e).length) throw new Error('Fix the highlighted fields');
      const row = {
        title: d.title.trim(), description: d.description.trim() || null, week_no: d.weekNo, session_no: d.sessionNo, duration_minutes: d.durationMinutes,
        objectives: linesToArray(d.objectives), activities: linesToArray(d.activities), topics: linesToArray(d.topics),
        expected_output: d.expectedOutput.trim() || null, assessment_notes: d.assessmentNotes.trim() || null,
      };
      const res = isEdit
        ? await supabase.from('curriculum_sessions').update(row).eq('id', editing.session.id)
        : await supabase.from('curriculum_sessions').insert({ ...row, programme_id: programmeId, track_id: trackId, source: 'admin_entered' });
      if (res.error) throw res.error;
    },
    onSuccess: onDone,
  });

  const text = (k: 'title' | 'description' | 'expectedOutput' | 'assessmentNotes', label: string, rows?: number) => (
    <label className="grid gap-1 text-sm font-medium sm:col-span-2">{label}
      {rows ? <textarea className={`${field} min-h-20`} value={d[k]} onChange={(e) => set(k, e.target.value)} /> : <input className={field} value={d[k]} onChange={(e) => set(k, e.target.value)} />}
      {errs[k] && <span role="alert" className="text-danger">{errs[k]}</span>}
    </label>
  );
  const num = (k: 'weekNo' | 'sessionNo' | 'durationMinutes', label: string) => (
    <label className="grid gap-1 text-sm font-medium">{label}
      <input type="number" className={field} value={Number.isNaN(d[k]) ? '' : d[k]} onChange={(e) => set(k, e.target.valueAsNumber)} />
      {errs[k] && <span role="alert" className="text-danger">{errs[k]}</span>}
    </label>
  );
  const lines = (k: 'objectives' | 'activities' | 'topics', label: string, hint: string) => (
    <label className="grid gap-1 text-sm font-medium sm:col-span-2">{label} <span className="font-normal text-ink/60">({hint})</span>
      <textarea className={`${field} min-h-24`} value={d[k]} onChange={(e) => set(k, e.target.value)} />
      {errs[k] && <span role="alert" className="text-danger">{errs[k]}</span>}
    </label>
  );

  return (
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} noValidate className="grid gap-3 rounded-card border border-purple-200 bg-purple-50/40 p-5 sm:grid-cols-3" aria-label={isEdit ? 'Edit session' : 'New session'}>
      <h2 className="font-display text-xl font-semibold text-purple-900 sm:col-span-3">{isEdit ? 'Edit session' : 'New session'}</h2>
      <div className="grid gap-3 sm:col-span-3 sm:grid-cols-2">{text('title', 'Title')}{text('description', 'Description', 3)}</div>
      {num('weekNo', 'Week (1 to 4)')}{num('sessionNo', 'Session number (1 to 8)')}{num('durationMinutes', 'Minutes (max 120)')}
      {isEdit && <p className="text-xs text-ink/70 sm:col-span-3">If this session has a detailed lesson plan, its timed segments must add up to the minutes above, so the database will refuse a different duration.</p>}
      <div className="grid gap-3 sm:col-span-3 sm:grid-cols-2">
        {lines('objectives', 'Learning objectives', 'one per line')}{lines('activities', 'Activities', 'one per line')}
        {lines('topics', 'Proposed extra topics', 'one per line; shown to trainers as awaiting approval')}
        {text('expectedOutput', 'Expected output', 2)}{text('assessmentNotes', 'Assessment notes', 2)}
      </div>
      <div className="flex flex-wrap gap-2 sm:col-span-3">
        <Button type="submit" disabled={save.isPending}>{isEdit ? 'Save changes' : 'Add session'}</Button>
        <Button type="button" variant="quiet" onClick={onCancel}>Cancel</Button>
      </div>
      {save.isError && <p role="alert" className="text-sm text-danger sm:col-span-3">{(save.error as Error).message}</p>}
    </form>
  );
}
