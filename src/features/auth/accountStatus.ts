// Deactivated accounts (migration 34). The database refuses every Data API request of an inactive account with
// code 42501 and message DIRA_ACCOUNT_INACTIVE; Supabase Auth refuses the sign-in of a banned (deactivated) user.
import type { Profile } from '@/types/database';

export const INACTIVE_MESSAGE = 'This account is not active. Contact the DIRA Foundation programme team.';

export function isInactiveAccountError(e: { code?: string; message?: string } | null | undefined): boolean {
  return Boolean(e && e.message === 'DIRA_ACCOUNT_INACTIVE');
}

/** Placeholder profile so the screens show the "not active" message (the real profile cannot be read any more). */
export function inactiveProfile(id: string): Profile {
  return { id, role: 'applicant', status: 'deactivated', first_name: '', last_name: '', organization_id: null };
}

/** Sign-in error text for people: a banned user is a deactivated account. */
export function signInErrorMessage(message: string): string {
  return /banned/i.test(message) ? INACTIVE_MESSAGE : message;
}
