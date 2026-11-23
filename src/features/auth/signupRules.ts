export const MIN_PASSWORD = 10;
export const isEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()) && s.trim().length <= 254;

/** Rules for a new password. Supabase enforces its own minimum too; this gives the message before the request is sent. */
export function validatePassword(password: string, email = ''): string | null {
  if (password.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Use both letters and numbers.';
  if (email && password.toLowerCase() === email.trim().toLowerCase()) return 'The password cannot be the same as your email address.';
  return null;
}

export function validateSignUp(i: { email: string; password: string; confirm: string; consent: boolean }): string | null {
  if (!isEmail(i.email)) return 'Enter a valid email address.';
  const p = validatePassword(i.password, i.email); if (p) return p;
  if (i.password !== i.confirm) return 'The two passwords do not match.';
  if (!i.consent) return 'Please tick the box to agree before creating your account.';
  return null;
}
