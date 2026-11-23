/** Why a PRODUCTION build must not start (null = fine). Development builds keep the local fallback for tests. */
export function supabaseConfigProblem(u: string | undefined, k: string | undefined, production: boolean): string | null {
  if (!production) return null;
  if (!u || !k) return 'The DIRA LEARN website was built without its database settings (VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY).';
  if (!/^https:\/\//.test(u) || /\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)([:/]|$)/.test(u)) return 'The DIRA LEARN website was built with a local or insecure database address.';
  return null;
}
