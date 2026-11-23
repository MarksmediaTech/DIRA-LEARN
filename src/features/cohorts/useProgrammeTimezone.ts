import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { DEFAULT_TIME_ZONE, isValidTimeZone } from '@/lib/timezone';

/** The programme time zone used to enter and show learning-access times. Falls back to the default while loading. */
export function useProgrammeTimezone(): { tz: string; programmeId: string | null; loading: boolean } {
  const q = useQuery({
    queryKey: ['programme-timezone'],
    queryFn: async () => {
      const { data, error } = await supabase.from('programmes').select('id, timezone').limit(1);
      if (error) throw error;
      return (data ?? [])[0] as { id: string; timezone: string } | undefined;
    },
  });
  const tz = q.data?.timezone && isValidTimeZone(q.data.timezone) ? q.data.timezone : DEFAULT_TIME_ZONE;
  return { tz, programmeId: q.data?.id ?? null, loading: q.isLoading };
}
