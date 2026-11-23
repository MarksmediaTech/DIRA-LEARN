import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useProgrammeTimezone } from '@/features/cohorts/useProgrammeTimezone';
import { formatInZone, todayInZone, zonedLocalToIso } from '@/lib/timezone';
import { AUTHORISABLE_ROLES, STATUS_LABEL, canPublishBriefs, objectivesToText, parseObjectives, validateBrief, mustPickCohort, type BriefStatus } from './rules';

interface BriefRow {
  id: string; brief_date: string; cohort_id: string | null; title: string; reflection: string | null; objectives: string[] | null;
  reflection_question: string | null; status: BriefStatus; publish_at: string | null; published_at: string | null;
}
interface EventRow { id: string; action: string; title: string; created_at: string; actor: string | null }
interface PublisherRow { profile_id: string }
interface PersonRow { id: string; first_name: string; last_name: string; role: string }

const field = 'rounded-control border border-purple-200 px-3 py-2 font-normal';
const EXECUTIVES = ['super_admin', 'founder', 'co_founder'];

export function BriefsPage() {
  const { profile } = useAuth();
  const { tz } = useProgrammeTimezone();
  const mine = useQuery({
    queryKey: ['brief-publisher-me', profile?.id],
    enabled: Boolean(profile),
    queryFn: async () => {
      const { data, error } = await supabase.from('brief_publishers').select('profile_id').eq('profile_id', profile?.id ?? '');
      if (error) throw error;
      return (data ?? []).length > 0;
    },
  });
  const allowed = canPublishBriefs(profile?.role, mine.data === true);
  const isExecutive = !!profile && EXECUTIVES.includes(profile.role);
  const [editing, setEditing] = useState<BriefRow | 'new' | null>(null);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-purple-700">Daily Briefs</h1>
        {allowed && editing === null && <Button onClick={() => setEditing('new')}>New brief</Button>}
      </div>
      {mine.isLoading && <p role="status">Checking your permissions…</p>}
      {!mine.isLoading && !allowed && <p role="status" className="rounded-card border border-purple-100 p-4 text-sm">You can see the briefs your role can read, but you are not authorised to write or publish them. A super administrator, Founder or Co-Founder can authorise you.</p>}
      {allowed && editing !== null && <BriefEditor key={editing === 'new' ? 'new' : editing.id} brief={editing === 'new' ? null : editing} role={profile?.role ?? null} tz={tz} onDone={() => setEditing(null)} />}
      <BriefList tz={tz} canEdit={allowed} onEdit={(b) => setEditing(b)} />
      {isExecutive && <Publishers />}
    </div>
  );
}

function BriefList({ tz, canEdit, onEdit }: { tz: string; canEdit: boolean; onEdit: (b: BriefRow) => void }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'all' | BriefStatus>('all');
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['briefs-admin'],
    queryFn: async () => {
      const { data, error: e } = await supabase.from('daily_briefs')
        .select('id, brief_date, cohort_id, title, reflection, objectives, reflection_question, status, publish_at, published_at').order('brief_date', { ascending: false }).limit(100);
      if (e) throw e;
      return (data ?? []) as BriefRow[];
    },
  });
  const cohorts = useQuery({
    queryKey: ['brief-cohort-names'],
    queryFn: async () => { const { data, error: e } = await supabase.from('cohorts').select('id, name'); if (e) throw e; return (data ?? []) as { id: string; name: string }[]; },
  });
  const events = useQuery({
    queryKey: ['brief-events', historyId], enabled: historyId !== null,
    queryFn: async () => {
      const { data, error: e } = await supabase.from('daily_brief_events').select('id, action, title, created_at, actor').eq('brief_id', historyId ?? '').order('created_at', { ascending: false });
      if (e) throw e;
      return (data ?? []) as EventRow[];
    },
  });
  const names = new Map((cohorts.data ?? []).map((c) => [c.id, c.name]));
  const move = useMutation({
    mutationFn: async (v: { id: string; status: BriefStatus }) => {
      const { error: e } = await supabase.from('daily_briefs').update({ status: v.status, ...(v.status === 'draft' || v.status === 'withdrawn' ? { publish_at: null } : {}) }).eq('id', v.id);
      if (e) throw e;
    },
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: ['briefs-admin'] }); void qc.invalidateQueries({ queryKey: ['brief-events'] }); },
    onError: (e: Error) => setError(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error: e } = await supabase.from('daily_briefs').delete().eq('id', id); if (e) throw e; },
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: ['briefs-admin'] }); },
    onError: (e: Error) => setError(e.message),
  });

  if (list.isLoading) return <p role="status">Loading briefs…</p>;
  if (list.isError) return <p role="alert" className="text-danger">Could not load briefs.</p>;
  const rows = (list.data ?? []).filter((b) => filter === 'all' || b.status === filter);
  return (
    <section aria-labelledby="brief-list-heading" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="brief-list-heading" className="text-xl font-semibold">Briefs</h2>
        <label className="flex items-center gap-2 text-sm font-medium">Show
          <select className={field} value={filter} onChange={(e) => setFilter(e.target.value as 'all' | BriefStatus)}>
            <option value="all">All</option>{(Object.keys(STATUS_LABEL) as BriefStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </label>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {rows.length === 0 && <EmptyState title="No briefs">Briefs appear here once they are written.</EmptyState>}
      <ul className="grid gap-3">
        {rows.map((b) => (
          <li key={b.id} className="grid gap-2 rounded-card border border-purple-100 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-semibold">{b.title}</p>
                <p className="text-sm text-ink/70">{b.brief_date} · {b.cohort_id ? names.get(b.cohort_id) ?? 'One cohort' : 'All cohorts'}{b.status === 'scheduled' && b.publish_at ? ` · publishes ${formatInZone(b.publish_at, tz)}` : ''}{b.status === 'published' && b.published_at ? ` · published ${formatInZone(b.published_at, tz)}` : ''}</p>
              </div>
              <span className="rounded-control bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-900">{STATUS_LABEL[b.status]}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {canEdit && <Button variant="quiet" onClick={() => onEdit(b)}>Edit</Button>}
              {canEdit && (b.status === 'draft' || b.status === 'withdrawn') && <Button disabled={move.isPending} onClick={() => move.mutate({ id: b.id, status: 'published' })}>Publish now</Button>}
              {canEdit && (b.status === 'published' || b.status === 'scheduled') && <Button variant="accent" disabled={move.isPending} onClick={() => move.mutate({ id: b.id, status: 'withdrawn' })}>Withdraw</Button>}
              {canEdit && b.status === 'scheduled' && <Button variant="quiet" disabled={move.isPending} onClick={() => move.mutate({ id: b.id, status: 'draft' })}>Back to draft</Button>}
              {canEdit && b.status === 'draft' && <Button variant="quiet" disabled={del.isPending} onClick={() => { if (window.confirm('Delete this draft? This cannot be undone.')) del.mutate(b.id); }}>Delete draft</Button>}
              <Button variant="quiet" onClick={() => setHistoryId(historyId === b.id ? null : b.id)}>History</Button>
            </div>
            {historyId === b.id && (
              <div className="rounded-card border border-purple-100 p-3 text-xs">
                {events.isLoading && <p role="status">Loading history…</p>}
                {events.isError && <p role="alert" className="text-danger">Could not load history.</p>}
                {events.data && events.data.length === 0 && <p>No history recorded.</p>}
                <ul className="grid gap-1">{(events.data ?? []).map((ev) => <li key={ev.id}><strong>{formatInZone(ev.created_at, tz)}</strong> · {ev.action.replace(/_/g, ' ')}</li>)}</ul>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function BriefEditor({ brief, role, tz, onDone }: { brief: BriefRow | null; role: string | null; tz: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(brief?.title ?? '');
  const [date, setDate] = useState(brief?.brief_date ?? todayInZone(tz));
  const [cohortId, setCohortId] = useState(brief?.cohort_id ?? '');
  const [reflection, setReflection] = useState(brief?.reflection ?? '');
  const [objectives, setObjectives] = useState(objectivesToText(brief?.objectives));
  const [question, setQuestion] = useState(brief?.reflection_question ?? '');
  const [publishAt, setPublishAt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const cohorts = useQuery({
    queryKey: ['brief-editor-cohorts'],
    queryFn: async () => { const { data, error: e } = await supabase.from('cohorts').select('id, name').eq('archived', false).order('start_date', { ascending: false }); if (e) throw e; return (data ?? []) as { id: string; name: string }[]; },
  });

  const save = useMutation({
    mutationFn: async (action: 'draft' | 'publish' | 'schedule') => {
      const publishAtIso = zonedLocalToIso(publishAt, tz);
      const bad = validateBrief({ title, briefDate: date, reflection, objectivesText: objectives, question, action, publishAtIso, cohortId, role });
      if (bad) throw new Error(bad);
      const status: BriefStatus = action === 'publish' ? 'published' : action === 'schedule' ? 'scheduled' : brief?.status === 'published' || brief?.status === 'scheduled' ? brief.status : 'draft';
      const row = {
        title: title.trim(), brief_date: date, cohort_id: cohortId || null, reflection: reflection.trim() || null,
        objectives: parseObjectives(objectives), reflection_question: question.trim() || null, status,
        publish_at: action === 'schedule' ? publishAtIso : status === 'scheduled' ? brief?.publish_at ?? null : null,
      };
      const { error: e } = brief ? await supabase.from('daily_briefs').update(row).eq('id', brief.id) : await supabase.from('daily_briefs').insert(row);
      if (e) throw e;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['briefs-admin'] }); void qc.invalidateQueries({ queryKey: ['brief-events'] }); onDone(); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <form onSubmit={(e) => e.preventDefault()} className="grid gap-3 rounded-card border border-purple-100 p-4 sm:grid-cols-2" aria-label={brief ? 'Edit brief' : 'New brief'}>
      <h2 className="text-xl font-semibold sm:col-span-2">{brief ? 'Edit brief' : 'New brief'}</h2>
      <label className="grid gap-1 text-sm font-medium sm:col-span-2">Title<input className={field} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} /></label>
      <label className="grid gap-1 text-sm font-medium">For the day<input type="date" className={field} value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <label className="grid gap-1 text-sm font-medium">Audience
        <select className={field} value={cohortId} onChange={(e) => setCohortId(e.target.value)}>
          {!mustPickCohort(role) && <option value="">All cohorts</option>}
          {mustPickCohort(role) && <option value="">Choose a cohort</option>}
          {(cohorts.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label className="grid gap-1 text-sm font-medium sm:col-span-2">Motivational reflection<textarea className={field} rows={3} value={reflection} onChange={(e) => setReflection(e.target.value)} maxLength={1200} /></label>
      <label className="grid gap-1 text-sm font-medium sm:col-span-2">Learning objectives (one per line, up to 8)<textarea className={field} rows={4} value={objectives} onChange={(e) => setObjectives(e.target.value)} /></label>
      <label className="grid gap-1 text-sm font-medium sm:col-span-2">Reflection question<input className={field} value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={400} /></label>
      <label className="grid gap-1 text-sm font-medium">Publish at (optional, {tz})<input type="datetime-local" className={field} value={publishAt} onChange={(e) => setPublishAt(e.target.value)} /></label>
      {error && <p role="alert" className="text-sm text-danger sm:col-span-2">{error}</p>}
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <Button type="button" variant="quiet" disabled={save.isPending} onClick={() => { setError(null); save.mutate('draft'); }}>{brief && brief.status !== 'draft' && brief.status !== 'withdrawn' ? 'Save changes' : 'Save draft'}</Button>
        <Button type="button" disabled={save.isPending} onClick={() => { setError(null); save.mutate('publish'); }}>Publish now</Button>
        <Button type="button" variant="accent" disabled={save.isPending} onClick={() => { setError(null); save.mutate('schedule'); }}>Schedule</Button>
        <Button type="button" variant="quiet" onClick={onDone}>Cancel</Button>
      </div>
    </form>
  );
}

/** Executives choose which staff and facilitators may write and publish briefs. */
function Publishers() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const people = useQuery({
    queryKey: ['brief-people'],
    queryFn: async () => {
      const [p, g] = await Promise.all([
        supabase.from('profiles').select('id, first_name, last_name, role').in('role', [...AUTHORISABLE_ROLES]).eq('status', 'active').order('last_name'),
        supabase.from('brief_publishers').select('profile_id'),
      ]);
      if (p.error) throw p.error;
      if (g.error) throw g.error;
      return { people: (p.data ?? []) as PersonRow[], granted: new Set(((g.data ?? []) as PublisherRow[]).map((x) => x.profile_id)) };
    },
  });
  const toggle = useMutation({
    mutationFn: async (v: { id: string; grant: boolean }) => {
      const { error: e } = v.grant ? await supabase.from('brief_publishers').insert({ profile_id: v.id }) : await supabase.from('brief_publishers').delete().eq('profile_id', v.id);
      if (e) throw e;
    },
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: ['brief-people'] }); void qc.invalidateQueries({ queryKey: ['brief-publisher-me'] }); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <section aria-labelledby="publishers-heading" className="grid gap-3">
      <h2 id="publishers-heading" className="text-xl font-semibold">Who can publish briefs</h2>
      <p className="text-sm text-ink/70">Super administrators, Founders and Co-Founders can always publish. Choose the staff and facilitators who may also write briefs. Facilitators can write only for their own cohorts.</p>
      {people.isLoading && <p role="status">Loading…</p>}
      {people.isError && <p role="alert" className="text-danger">Could not load people.</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <ul className="grid gap-2">
        {(people.data?.people ?? []).map((p) => {
          const on = people.data?.granted.has(p.id) ?? false;
          return (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-purple-100 p-3 text-sm">
              <span>{`${p.first_name} ${p.last_name}`.trim() || 'Unnamed'} <span className="text-ink/60">· {p.role.replace(/_/g, ' ')}</span></span>
              <Button variant={on ? 'accent' : 'quiet'} disabled={toggle.isPending} onClick={() => toggle.mutate({ id: p.id, grant: !on })}>{on ? 'Remove authorisation' : 'Authorise'}</Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
