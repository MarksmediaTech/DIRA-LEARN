import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { latestAttempt, learnerState, type AttemptLike, type LearnerState } from './rules';

export interface MyAssignmentItem {
  id: string; title: string; dueAt: string | null; maxScore: number | null; track: string | null;
  state: LearnerState; submittedAt: string | null; score: number | null;
}

interface AssignmentRow { id: string; title: string; due_at: string | null; allow_resubmission: boolean; max_score: number | null; tracks: { name: string } | null }
interface SubRow extends AttemptLike { assignment_id: string; submitted_at: string; score: number | null }

/** The signed-in learner's assignments with their own submission state. Row level security already limits this to their own work. */
export function useMyAssignments() {
  return useQuery({
    queryKey: ['my-assignments'],
    queryFn: async (): Promise<MyAssignmentItem[]> => {
      const [a, s] = await Promise.all([
        supabase.from('assignments').select('id, title, due_at, allow_resubmission, max_score, tracks(name)').order('due_at', { ascending: true, nullsFirst: false }),
        supabase.from('submissions').select('assignment_id, attempt, status, submitted_at, score'),
      ]);
      if (a.error) throw a.error;
      if (s.error) throw s.error;
      const subs = (s.data ?? []) as unknown as SubRow[];
      return ((a.data ?? []) as unknown as AssignmentRow[]).map((row) => {
        const mine = subs.filter((x) => x.assignment_id === row.id);
        const last = latestAttempt(mine);
        return {
          id: row.id, title: row.title, dueAt: row.due_at, maxScore: row.max_score, track: row.tracks?.name ?? null,
          state: learnerState({ dueAt: row.due_at, allowResubmission: row.allow_resubmission }, mine),
          submittedAt: last?.submitted_at ?? null, score: last?.score ?? null,
        };
      });
    },
  });
}
