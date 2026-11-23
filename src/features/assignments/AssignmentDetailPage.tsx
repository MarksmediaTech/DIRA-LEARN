import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { EmptyState } from '@/components/ui/EmptyState';
import type { Assignment } from '@/types/database';
import { SubmitPanel } from './SubmitPanel';
import { GradingPanel } from './GradingPanel';

type Row = Assignment & { cohorts: { name: string } | null; tracks: { name: string } | null };

export function AssignmentDetailPage() {
  const { assignmentId = '' } = useParams();
  const { profile } = useAuth();
  const q = useQuery({
    queryKey: ['assignment', assignmentId],
    queryFn: async () => {
      const { data, error } = await supabase.from('assignments')
        .select('id, cohort_id, track_id, title, instructions, due_at, allow_resubmission, max_score, created_at, cohorts(name), tracks(name)').eq('id', assignmentId).maybeSingle();
      if (error) throw error;
      return data as unknown as Row | null;
    },
  });
  if (q.isLoading) return <p role="status">Loading assignment…</p>;
  if (q.isError) return <p role="alert" className="text-danger">Could not load this assignment.</p>;
  const a = q.data;
  if (!a) return <EmptyState title="Assignment not found">It may have been removed, or you may not have access.</EmptyState>;

  return (
    <section className="grid max-w-3xl gap-6">
      <header>
        <Link to="/assignments" className="text-sm text-purple-700 underline">All assignments</Link>
        <h1 className="mt-1 text-2xl font-bold text-purple-700">{a.title}</h1>
        <p className="text-sm text-ink/70">
          {a.cohorts?.name}{a.tracks ? ` · ${a.tracks.name}` : ''} · {a.due_at ? `Due ${new Date(a.due_at).toLocaleString()}` : 'No due date'}
          {a.max_score !== null ? ` · out of ${a.max_score}` : ' · feedback only'}{a.allow_resubmission ? ' · resubmission allowed if returned' : ''}
        </p>
      </header>
      {a.instructions && <p className="whitespace-pre-wrap rounded-card border border-purple-100 p-5 text-sm">{a.instructions}</p>}
      {profile?.role === 'participant' ? <SubmitPanel a={a} /> : <GradingPanel a={a} />}
    </section>
  );
}
