/** Pulls a readable message out of a failed Edge Function call (the body of a non-2xx response). */
export async function readFunctionError(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx instanceof Response) {
    try { const body = (await ctx.clone().json()) as { error?: unknown }; if (typeof body.error === 'string') return body.error; } catch { /* fall through */ }
  }
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export const setupCodeProblem = (code: string): string | null => (code.trim().length === 0 ? 'Enter the setup code.' : null);

/** Same rule as the Edge Function bootstrap-first-admin (stricter than sign-up, because this account controls everything). */
export const ADMIN_MIN_PASSWORD = 12;
export function adminPasswordProblem(password: string, confirm: string): string | null {
  if (password.length < ADMIN_MIN_PASSWORD) return `The password must have at least ${ADMIN_MIN_PASSWORD} characters.`;
  if (password.length > 72) return 'The password can have at most 72 characters.';
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return 'Use both letters and numbers in the password.';
  if (/^(.)\1+$/.test(password)) return 'The password cannot be one character repeated.';
  if (password !== confirm) return 'The two passwords do not match.';
  return null;
}

/** HTTP status of a failed Edge Function call, when there is one. */
export const functionStatus = (error: unknown): number | null => {
  const ctx = (error as { context?: unknown } | null)?.context;
  return ctx instanceof Response ? ctx.status : null;
};
