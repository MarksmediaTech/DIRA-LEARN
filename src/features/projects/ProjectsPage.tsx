import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { FILE_NOT_AVAILABLE } from '@/lib/files';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { Milestone, ParticipantProject } from '@/types/database';
import { STATUS_LABEL, mergeMilestones, milestoneProgress, parseMilestones, participantCanEdit, validateEvidenceFile } from './rules';

interface Person { first_name: string; last_name: string }
interface ProjectRow extends ParticipantProject { participants: { participant_no: string; profiles: Person | null } | null }
interface Evidence { id: string; project_id: string; storage_path: string; mime_type: string | null; uploaded_at: string }
const COLS = 'id, participant_id, track_id, title, description, milestones, status, feedback, created_at, participants(participant_no, profiles(first_name, last_name))';
const field = 'rounded-control border border-purple-200 px-3 py-2 font-normal';
const nameOf = (p: Person | null | undefined) => (p ? `${p.first_name} ${p.last_name}`.trim() || 'Unnamed' : 'Unnamed');

export function ProjectsPage() {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const isParticipant = profile?.role === 'participant';
  const [error, setError] = useState<string | null>(null);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['projects'] }); };

  const projects = useQuery({
    queryKey: ['projects', 'list'],
    queryFn: async () => { const { data, error: e } = await supabase.from('participant_projects').select(COLS).order('created_at', { ascending: false }); if (e) throw e; return data as unknown as ProjectRow[]; },
  });
  const evidence = useQuery({
    queryKey: ['projects', 'evidence', (projects.data ?? []).map((p) => p.id).join(',')],
    enabled: Boolean(projects.data?.length),
    queryFn: async () => { const { data, error: e } = await supabase.from('project_evidence').select('id, project_id, storage_path, mime_type, uploaded_at').in('project_id', projects.data!.map((p) => p.id)); if (e) throw e; return data as Evidence[]; },
  });
  const myTrack = useQuery({
    queryKey: ['projects', 'track'], enabled: isParticipant,
    queryFn: async () => { const { data, error: e } = await supabase.from('cohort_enrolments').select('track_id').maybeSingle(); if (e) throw e; return (data as { track_id: string | null } | null)?.track_id ?? null; },
  });

  // ---- create (participant) ----
  const [title, setTitle] = useState(''); const [description, setDescription] = useState(''); const [steps, setSteps] = useState('');
  const create = useMutation({
    mutationFn: async () => {
      if (title.trim().length < 3) throw new Error('Give your project a title.');
      const m = parseMilestones(steps); if (m.error) throw new Error(m.error);
      const { error: e } = await supabase.from('participant_projects').insert({ participant_id: (await myParticipantId()), track_id: myTrack.data ?? null, title: title.trim(), description: description.trim() || null, milestones: m.milestones });
      if (e) throw e;
    },
    onSuccess: () => { setTitle(''); setDescription(''); setSteps(''); setError(null); refresh(); },
    onError: (e: Error) => setError(e.message),
  });
  const update = useMutation({
    mutationFn: async (v: { id: string; patch: Record<string, unknown> }) => { const { error: e } = await supabase.from('participant_projects').update(v.patch).eq('id', v.id); if (e) throw e; },
    onSuccess: () => { setError(null); refresh(); }, onError: (e: Error) => setError(e.message),
  });
  const upload = useMutation({
    mutationFn: async (v: { projectId: string; file: File }) => {
      const problem = validateEvidenceFile(v.file); if (problem) throw new Error(problem);
      const safe = v.file.name.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80);
      const path = `${profile!.id}/${v.projectId}/${Date.now()}-${safe}`;
      const up = await supabase.storage.from('project-evidence').upload(path, v.file, { contentType: v.file.type });
      if (up.error) throw up.error;
      const { error: e } = await supabase.from('project_evidence').insert({ project_id: v.projectId, storage_path: path, mime_type: v.file.type });
      if (e) { await supabase.storage.from('project-evidence').remove([path]); throw e; }
    },
    onSuccess: () => { setError(null); refresh(); }, onError: (e: Error) => setError(e.message),
  });
  const open = async (path: string) => {
    const { data, error: e } = await supabase.storage.from('project-evidence').createSignedUrl(path, 120);
    if (e || !data) { setError(FILE_NOT_AVAILABLE); return; }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const evByProject = useMemo(() => { const m = new Map<string, Evidence[]>(); for (const ev of evidence.data ?? []) m.set(ev.project_id, [...(m.get(ev.project_id) ?? []), ev]); return m; }, [evidence.data]);

  if (projects.isLoading) return <p role="status">Loading…</p>;
  if (projects.isError) return <p role="alert" className="text-danger">Could not load projects.</p>;

  return (
    <section className="grid max-w-4xl gap-5">
      <h1 className="text-2xl font-bold text-purple-700">{isParticipant ? 'My projects and portfolio' : 'Participant projects'}</h1>
      {isParticipant && (
        <form className="grid gap-3 rounded-card border border-purple-100 p-4" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <h2 className="font-display text-lg font-semibold">Start a project</h2>
          <label className="grid gap-1 text-sm font-medium">Title<input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} className={field} /></label>
          <label className="grid gap-1 text-sm font-medium">What will you make or do?<textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={field} /></label>
          <label className="grid gap-1 text-sm font-medium">Milestones <span className="font-normal text-ink/60">(one per line)</span><textarea rows={3} value={steps} onChange={(e) => setSteps(e.target.value)} className={field} /></label>
          <Button type="submit" disabled={create.isPending} className="justify-self-start">Create project</Button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!projects.data?.length && <EmptyState title="No projects yet">{isParticipant ? 'Start your first project above. Your trainer reviews it when you submit.' : 'Projects started by participants you work with appear here.'}</EmptyState>}
      {(projects.data ?? []).map((p) => (
        <ProjectCard key={p.id} p={p} files={evByProject.get(p.id) ?? []} isParticipant={isParticipant} busy={update.isPending || upload.isPending}
          onPatch={(patch) => update.mutate({ id: p.id, patch })} onUpload={(file) => upload.mutate({ projectId: p.id, file })} onOpen={(path) => void open(path)} />
      ))}
    </section>
  );
}

async function myParticipantId(): Promise<string> {
  const { data, error } = await supabase.from('participants').select('id').maybeSingle();
  if (error || !data) throw new Error('Your participant record was not found.');
  return (data as { id: string }).id;
}

function ProjectCard({ p, files, isParticipant, busy, onPatch, onUpload, onOpen }: {
  p: ProjectRow; files: Evidence[]; isParticipant: boolean; busy: boolean;
  onPatch: (patch: Record<string, unknown>) => void; onUpload: (f: File) => void; onOpen: (path: string) => void;
}) {
  const [feedback, setFeedback] = useState(p.feedback ?? '');
  const [editing, setEditing] = useState(false);
  const [steps, setSteps] = useState(p.milestones.map((m) => m.title).join('\n'));
  const [desc, setDesc] = useState(p.description ?? '');
  const [local, setLocal] = useState<string | null>(null);
  const prog = milestoneProgress(p.milestones);
  const canEdit = isParticipant && participantCanEdit(p.status);

  const toggle = (i: number) => onPatch({ milestones: p.milestones.map((m, j): Milestone => (j === i ? { ...m, done: !m.done } : m)) });
  const saveEdit = () => {
    const m = parseMilestones(steps); if (m.error) { setLocal(m.error); return; }
    setLocal(null); setEditing(false);
    onPatch({ description: desc.trim() || null, milestones: mergeMilestones(m.milestones, p.milestones) });
  };
  const decide = (status: 'needs_revision' | 'reviewed') => {
    if (status === 'needs_revision' && feedback.trim().length < 5) { setLocal('Write feedback so the participant knows what to change.'); return; }
    setLocal(null); onPatch({ status, feedback: feedback.trim() || null });
  };

  return (
    <article className="grid gap-3 rounded-card border border-purple-100 p-4 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-semibold">{p.title}</h2>
          {!isParticipant && <p className="text-xs text-ink/60">{nameOf(p.participants?.profiles)} · {p.participants?.participant_no}</p>}
        </div>
        <span className="rounded-full bg-purple-50 px-3 py-1 text-xs font-semibold text-purple-700">{STATUS_LABEL[p.status]}</span>
      </div>
      {editing ? (
        <div className="grid gap-2">
          <label className="grid gap-1 font-medium">Description<textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} className={field} /></label>
          <label className="grid gap-1 font-medium">Milestones (one per line)<textarea rows={4} value={steps} onChange={(e) => setSteps(e.target.value)} className={field} /></label>
          <div className="flex gap-2"><Button type="button" onClick={saveEdit} disabled={busy}>Save</Button><Button type="button" variant="quiet" onClick={() => setEditing(false)}>Cancel</Button></div>
        </div>
      ) : p.description && <p className="whitespace-pre-wrap">{p.description}</p>}
      {p.milestones.length > 0 && (
        <div>
          <p className="font-semibold">Milestones ({prog.done} of {prog.total} done)</p>
          <ul className="mt-1 grid gap-1">{p.milestones.map((m, i) => (
            <li key={`${i}-${m.title}`}><label className="flex items-center gap-2"><input type="checkbox" checked={m.done} disabled={!canEdit || busy} onChange={() => toggle(i)} />{m.title}</label></li>))}</ul>
        </div>
      )}
      <div>
        <p className="font-semibold">Evidence</p>
        {!files.length && <p className="text-ink/60">No files yet.</p>}
        <ul className="grid gap-1">{files.map((f) => <li key={f.id}><button type="button" className="text-purple-700 underline" onClick={() => onOpen(f.storage_path)}>{f.storage_path.split('/').pop()?.replace(/^\d+-/, '')}</button></li>)}</ul>
        {canEdit && (
          <label className="mt-2 grid max-w-sm gap-1 font-medium">Add a file (PDF, JPG, PNG or MP4, up to 10 MB)
            <input type="file" accept=".pdf,.jpg,.jpeg,.png,.mp4" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = ''; }} />
          </label>
        )}
      </div>
      {p.feedback && isParticipant && <p className="rounded-control bg-orange-50 p-3"><strong>Trainer feedback:</strong> {p.feedback}</p>}
      {local && <p role="alert" className="text-danger">{local}</p>}
      {isParticipant ? (
        <div className="flex flex-wrap gap-2">
          {canEdit && !editing && <Button variant="quiet" type="button" onClick={() => setEditing(true)}>Edit details</Button>}
          {canEdit && <Button type="button" disabled={busy} onClick={() => { if (window.confirm('Submit this project for review? You cannot change it until your trainer returns it.')) onPatch({ status: 'submitted' }); }}>Submit for review</Button>}
        </div>
      ) : (
        <div className="grid gap-2">
          <label className="grid gap-1 font-medium">Feedback<textarea rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} className={field} /></label>
          <div className="flex flex-wrap gap-2">
            <Button variant="quiet" type="button" disabled={busy} onClick={() => decide('needs_revision')}>Return for changes</Button>
            <Button type="button" disabled={busy} onClick={() => decide('reviewed')}>Mark as reviewed</Button>
          </div>
        </div>
      )}
    </article>
  );
}
