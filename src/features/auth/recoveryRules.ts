import { isEmail, validatePassword } from './signupRules';

// Self-service password recovery (Supabase Auth: resetPasswordForEmail -> verifyOtp type 'recovery' -> updateUser).
// Nothing in this file, or in the recovery screens, ever logs or stores a code or a password.

export const RESEND_COOLDOWN_SECONDS = 60;      // matches [auth.email] max_frequency in supabase/config.toml
export const CODE_LIFETIME_MINUTES = 15;        // matches [auth.email] otp_expiry = 900
export const MAX_CODE_ATTEMPTS = 5;             // after this many wrong codes the screen asks for a new code (the server also rate-limits)

/** Shown after every request, whether or not the address has an account, so nobody can find out who is registered. */
export const GENERIC_SENT =
  'If an account exists for this email address, we have sent a password reset code to it. The code works for 15 minutes. Check your spam folder if you cannot see it.';

export const normaliseEmail = (s: string): string => s.trim().toLowerCase();

/** Codes are 6 digits (configurable in Supabase up to 10). Spaces and dashes that people type or paste are ignored. */
export const cleanCode = (s: string): string => s.replace(/[\s-]/g, '');
export const isCodeShaped = (s: string): boolean => /^\d{6,10}$/.test(cleanCode(s));

export function validateRecoveryEmail(email: string): string | null {
  return isEmail(email) ? null : 'Enter the email address you use to sign in.';
}

/** Existing DIRA LEARN password rules, plus the confirmation. */
export function validateNewPassword(password: string, confirm: string, email: string): string | null {
  const p = validatePassword(password, email);
  if (p) return p;
  if (password !== confirm) return 'The two passwords do not match.';
  return null;
}

/** Seconds left before another code may be requested (0 = allowed now). */
export function cooldownLeft(lastSentAt: number | null, now: number, cooldown = RESEND_COOLDOWN_SECONDS): number {
  if (lastSentAt === null) return 0;
  return Math.max(0, Math.ceil(cooldown - (now - lastSentAt) / 1000));
}

export type RecoveryProblem = 'rate_limited' | 'invalid_code' | 'weak_password' | 'same_password' | 'session_missing' | 'network' | 'unknown';

/** Maps a Supabase Auth error (AuthApiError: status + code) to a problem the screens can explain. */
export function classifyAuthError(err: unknown): RecoveryProblem {
  const e = (err && typeof err === 'object' ? err : {}) as { status?: number; code?: string; name?: string; message?: string };
  const code = e.code ?? '';
  if (e.status === 429 || code.startsWith('over_') || code === 'too_many_requests') return 'rate_limited';
  if (code === 'otp_expired') return 'invalid_code';                       // Supabase: "Token has expired or is invalid"
  if (code === 'weak_password') return 'weak_password';
  if (code === 'same_password') return 'same_password';
  if (code === 'session_not_found' || code === 'session_expired' || code === 'bad_jwt' || code === 'no_authorization'
      || e.name === 'AuthSessionMissingError') return 'session_missing';
  if (e.name === 'AuthRetryableFetchError' || e.status === 0) return 'network';
  return 'unknown';
}

export const PROBLEM_MESSAGES: Record<RecoveryProblem, string> = {
  rate_limited: 'Too many attempts. Please wait a few minutes before trying again.',
  invalid_code: 'That code is not correct or has expired. Check the latest email from DIRA LEARN, or ask for a new code.',
  weak_password: 'This password is too weak. Use at least 10 characters with both letters and numbers.',
  same_password: 'Choose a password that is different from your old one.',
  session_missing: 'Your verification has expired. Please start again and ask for a new code.',
  network: 'We could not reach DIRA LEARN. Check your internet connection and try again.',
  unknown: 'Something went wrong. Please try again in a few minutes.',
};

// While a recovery is verified but the new password is not yet saved, the app keeps the person on the new-password screen
// (the recovery session must not be used to browse DIRA LEARN). Stored per browser so every tab sees it; holds no secret.
export const RECOVERY_FLAG = 'dira.recovery.pending';
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const store = (): Store | null => { try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; } };
export function markRecoveryPending(s: Store | null = store()): void { try { s?.setItem(RECOVERY_FLAG, String(Date.now())); } catch { /* storage unavailable */ } }
export function clearRecoveryPending(s: Store | null = store()): void { try { s?.removeItem(RECOVERY_FLAG); } catch { /* storage unavailable */ } }
export function isRecoveryPending(s: Store | null = store()): boolean { try { return !!s?.getItem(RECOVERY_FLAG); } catch { return false; } }
