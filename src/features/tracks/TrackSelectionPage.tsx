import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { Track } from '@/types/database';

interface Enrolment { cohort_id: string; track_id: string | null; track_selected_at: string | null }

export function TrackSelectionPage() {
  const qc = useQueryClient();
  const tracks = useQuery({
    queryKey: ['tracks'],
    queryFn: async () => {
      const { data, error } = await supabase.from('tracks').select('id, code, name, focus, position').order('position');
      if (error) throw error;
      return data as Track[];
    },
  });
  const enrolment = useQuery({
    queryKey: ['my-enrolment'],
    queryFn: async () => {
      const { data, error } = await supabase.from('cohort_enrolments').select('cohort_id, track_id, track_selected_at').limit(1).maybeSingle();
      if (error) throw error;
      return data as Enrolment | null;
    },
  });
  const choose = useMutation({
    mutationFn: async (trackId: string) => {
      // Rule enforcement (core sessions completed first) lives in the select_track() database function.
      const { error } = await supabase.rpc('select_track', { p_cohort: enrolment.data!.cohort_id, p_track: trackId });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['my-enrolment'] }),
  });

  if (tracks.isLoading || enrolment.isLoading) return <p role="status">Loading tracks…</p>;
  if (tracks.isError || enrolment.isError) return <p role="alert" className="text-danger">Could not load tracks. Try again shortly.</p>;
  if (!enrolment.data) return <EmptyState title="You are not enrolled in a cohort yet">The programme team will enrol you after your application is accepted.</EmptyState>;

  return (
    <section className="grid max-w-3xl gap-4">
      <h1 className="text-2xl font-bold text-purple-700">Choose your specialist track</h1>
      <p className="text-ink/70">You complete the same two core sessions first, then follow one track for Weeks 2 to 4.</p>
      {choose.isError && <p role="alert" className="text-sm text-danger">{(choose.error as Error).message}</p>}
      <ul className="grid gap-3">
        {tracks.data?.map((t) => {
          const current = enrolment.data?.track_id === t.id;
          return (
            <li key={t.id} className={`flex items-center justify-between gap-4 rounded-card border p-4 ${current ? 'border-purple-600 bg-purple-50' : 'border-purple-100'}`}>
              <div><h2 className="text-lg font-semibold">{t.name}</h2><p className="text-sm text-ink/70">{t.focus}</p></div>
              <Button variant={current ? 'quiet' : 'primary'} disabled={current || choose.isPending} onClick={() => choose.mutate(t.id)}>
                {current ? 'Selected' : 'Select track'}
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
