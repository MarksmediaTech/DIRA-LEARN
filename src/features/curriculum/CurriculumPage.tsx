import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { EmptyState } from '@/components/ui/EmptyState';
import type { CurriculumSession, Track } from '@/types/database';
import { LessonPlanView } from './LessonPlanView';

export function groupByTrack(sessions: CurriculumSession[], tracks: Track[]) {
  const core = sessions.filter((s) => s.track_id === null).sort((a, b) => a.session_no - b.session_no);
  const perTrack = tracks.map((t) => ({ track: t, sessions: sessions.filter((s) => s.track_id === t.id).sort((a, b) => a.session_no - b.session_no) }));
  return { core, perTrack };
}

export interface SessionTopics { approved: string[]; awaiting: string[] }

function SessionCard({ s, topics }: { s: CurriculumSession; topics: SessionTopics | undefined }) {
  const [open, setOpen] = useState(false);   // the lesson plan loads only when opened
  return (
    <li className="rounded-card border border-purple-100 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">Session {s.session_no}: {s.title}</h3>
        <span className="text-xs text-ink/60">Week {s.week_no}, {s.duration_minutes} min</span>
      </div>
      {s.description && <p className="mt-1 text-sm text-ink/80">{s.description}</p>}
      {s.expected_output && <p className="mt-2 text-sm"><span className="font-medium">Output:</span> {s.expected_output}</p>}
      {topics && topics.approved.length > 0 && (
        <div className="mt-2 text-sm"><span className="font-medium">Approved topics:</span><ul className="mt-1 list-disc pl-5">{topics.approved.map((t) => <li key={t}>{t}</li>)}</ul></div>
      )}
      {topics && topics.awaiting.length > 0 && <p className="mt-2 text-sm text-warn">Proposed topics awaiting approval: {topics.awaiting.join('; ')}</p>}
      {!s.is_approved && <p className="mt-2 text-xs text-ink/60">Draft content: not yet approved by programme management.</p>}
      <button type="button" aria-expanded={open} aria-controls={`plan-${s.id}`} onClick={() => setOpen((x) => !x)} className="mt-3 text-sm font-semibold text-purple-700 underline">
        {open ? 'Hide detailed lesson plan' : 'Show detailed lesson plan'}
      </button>
      {open && <div id={`plan-${s.id}`} className="mt-3"><LessonPlanView sessionId={s.id} durationMinutes={s.duration_minutes} /></div>}
    </li>
  );
}

export function CurriculumPage() {
  const q = useQuery({
    queryKey: ['curriculum'],
    queryFn: async () => {
      const [t, s, tp] = await Promise.all([
        supabase.from('tracks').select('id, code, name, focus, position').order('position'),
        supabase.from('curriculum_sessions').select('*').order('session_no'),
        supabase.from('v_session_topics').select('session_id, approved_topics, awaiting_topics'),
      ]);
      if (t.error) throw t.error;
      if (s.error) throw s.error;
      // Official topics = approved proposals. If the topic view is unavailable the page still works and shows the session's own proposed list.
      const topics = new Map<string, SessionTopics>();
      if (!tp.error) for (const r of tp.data as { session_id: string; approved_topics: string[]; awaiting_topics: string[] }[]) topics.set(r.session_id, { approved: r.approved_topics ?? [], awaiting: r.awaiting_topics ?? [] });
      else for (const x of s.data as CurriculumSession[]) topics.set(x.id, { approved: [], awaiting: x.topics });
      return { ...groupByTrack(s.data as CurriculumSession[], t.data as Track[]), topics };
    },
  });
  if (q.isLoading) return <p role="status">Loading curriculum…</p>;
  if (q.isError) return <p role="alert" className="text-danger">Could not load the curriculum.</p>;
  if (!q.data || (q.data.core.length === 0 && q.data.perTrack.every((t) => t.sessions.length === 0))) {
    return <EmptyState title="No curriculum yet">An administrator can add sessions in curriculum management.</EmptyState>;
  }
  return (
    <section className="grid max-w-3xl gap-8">
      <h1 className="text-2xl font-bold text-purple-700">Curriculum</h1>
      <div><h2 className="mb-3 text-xl font-semibold">Shared core (Week 1)</h2><ul className="grid gap-3">{q.data.core.map((s) => <SessionCard key={s.id} s={s} topics={q.data!.topics.get(s.id)} />)}</ul></div>
      {q.data.perTrack.map(({ track, sessions }) => (
        <div key={track.id}><h2 className="mb-3 text-xl font-semibold">{track.name}</h2>
          {sessions.length ? <ul className="grid gap-3">{sessions.map((s) => <SessionCard key={s.id} s={s} topics={q.data!.topics.get(s.id)} />)}</ul> : <p className="text-sm text-ink/60">No sessions yet.</p>}
        </div>
      ))}
    </section>
  );
}
