import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { describeAccess, headlineAccess, type AccessStatus } from '@/features/cohorts/accessRules';
import { useProgrammeTimezone } from '@/features/cohorts/useProgrammeTimezone';

interface Row { cohort_id: string; cohort_name: string; status: AccessStatus; opens_at: string | null; closes_at: string | null }

/** Tells a learner why programme materials are closed, using only their own access record. Renders nothing when access is open. */
export function AccessBanner() {
  const { tz } = useProgrammeTimezone();
  const q = useQuery({
    queryKey: ['my-learning-access'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('my_learning_access');
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
  if (!q.data) return null;
  const top = headlineAccess(q.data);
  if (!top || top.status === 'active') return null;
  return (
    <div role="status" className="rounded-card border border-orange-200 bg-orange-50 p-4 text-sm text-ink">
      <p className="font-semibold">Learning access: {top.status}</p>
      <p>{describeAccess(top.status, top.opens_at, top.closes_at, tz)}</p>
    </div>
  );
}
