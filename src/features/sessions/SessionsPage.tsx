import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { EmptyState } from '@/components/ui/EmptyState';
import { bucketFor, type Bucket } from './rules';

interface Row {
  id: string; cohort_id: string; trainer_id: string | null; starts_at: string; ends_at: string; status: string; mode: string; venue: string | null;
  curriculum_sessions: { title: string; session_no: number; week_no: number; track_id: string | null } | null;
  cohorts: { name: string } | null;
}
const HEADINGS: Record<Bucket, string> = { today: 'Today', upcoming: 'Upcoming', past: 'Past' };

export function SessionsPage() {
  const { profile, session } = useAuth();
  const isTrainer = profile?.role === 'trainer';
  const [mineOnly, setMineOnly] = useState(true);

  const q = useQuery({
    queryKey: ['my-sessions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('session_schedules')
        .select('id, cohort_id, trainer_id, starts_at, ends_at, status, mode, venue, curriculum_sessions(title, session_no, week_no, track_id), cohorts(name)')
        .order('starts_at', { ascending: true }).limit(300);
      if (error) throw error;
      return data as unknown as Row[];
    },
  });

  if (q.isLoading) return <p role="status">Loading sessions…</p>;
  if (q.isError) return <p role="alert" className="text-danger">Could not load sessions. Check your connection and try again.</p>;

  const rows = (q.data ?? []).filter((r) => !(isTrainer && mineOnly) || r.trainer_id === session?.user.id);
  const groups: Record<Bucket, Row[]> = { today: [], upcoming: [], past: [] };
  for (const r of rows) groups[bucketFor({ startsAt: r.starts_at, endsAt: r.ends_at, status: r.status })].push(r);
  groups.past.reverse();   // most recent first

  return (
    <section className="grid max-w-3xl gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-purple-700">{isTrainer ? 'My sessions' : 'Sessions'}</h1>
        {isTrainer && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />Only sessions assigned to me</label>}
      </div>
      {rows.length === 0 ? (
        <EmptyState title="No sessions to show">{isTrainer && mineOnly ? 'Sessions assigned to you will appear here. Untick the box to see all sessions in your cohorts.' : 'Sessions appear here once a coordinator schedules them.'}</EmptyState>
      ) : (['today', 'upcoming', 'past'] as const).map((b) => groups[b].length > 0 && (
        <div key={b}>
          <h2 className="mb-2 font-display text-lg font-semibold text-purple-900">{HEADINGS[b]}</h2>
          <ul className="divide-y divide-purple-100 rounded-card border border-purple-100">
            {groups[b].map((r) => (
              <li key={r.id}>
                <Link to={`/sessions/${r.id}`} className="grid gap-0.5 p-3 hover:bg-purple-50">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">Session {r.curriculum_sessions?.session_no}: {r.curriculum_sessions?.title ?? 'Session'}</span>
                    <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">{r.status}</span>
                  </span>
                  <span className="text-sm text-ink/70">{r.cohorts?.name} · {new Date(r.starts_at).toLocaleString()} · {r.mode}{r.venue ? ` · ${r.venue}` : ''}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
