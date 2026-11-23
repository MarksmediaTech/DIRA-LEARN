import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { readFunctionErrorMessage } from '@/lib/functionError';

/**
 * Direct enrolment of learners imported from CSV (22 Nov 2026). import-learners records the programme track in the account's
 * app_metadata (server-only); after the learner has set a password and signed in with it, complete-enrolment makes them an
 * active participant. This is only a hint for the website: the server checks everything again.
 */
export function hasPendingEnrolment(user: User | null | undefined): boolean {
  const e = (user?.app_metadata as { dira_enrolment?: { track_id?: unknown; completed_at?: unknown } } | undefined)?.dira_enrolment;
  return Boolean(e && typeof e.track_id === 'string' && !e.completed_at);
}

export type EnrolmentResult = { ok: true } | { ok: false; message: string };

export async function completeEnrolment(): Promise<EnrolmentResult> {
  try {
    const { data, error } = await supabase.functions.invoke('complete-enrolment', { body: {} });
    if (error) return { ok: false, message: await readFunctionErrorMessage(error) };
    return (data as { enrolled?: unknown } | null)?.enrolled === true ? { ok: true } : { ok: false, message: 'The server gave an unexpected answer.' };
  } catch {
    return { ok: false, message: 'We could not reach DIRA LEARN. Check your internet connection and try again.' };
  }
}
