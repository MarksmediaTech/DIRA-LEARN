// Edge Function: creates the FIRST Super Administrator of a new DIRA LEARN installation (21 Nov 2026).
// Called from the website's /setup page by the person installing DIRA LEARN, who enters the one-time SETUP_CODE and chooses
// the administrator's password. The account is ALWAYS the address in the FIRST_ADMIN_EMAIL secret - the caller cannot choose
// another one. Through the Supabase Auth Admin API it creates that account (email already confirmed), or, if the account
// already exists, sets its password; then the protected database function claim_first_admin() makes it Super Administrator.
// Refuses (and changes nothing) when: SETUP_CODE or FIRST_ADMIN_EMAIL is not set; an active Super Administrator exists; the
// code is wrong (1-second delay, constant-time comparison); the password is too weak; the existing account is not an active
// applicant. Remove SETUP_CODE afterwards: setup is then switched off for good.
// Self-contained on purpose (no shared imports), so it can also be deployed by pasting it into the Supabase Dashboard.
// Secrets: SETUP_CODE (>= 20 characters), FIRST_ADMIN_EMAIL, APP_URL (the website address), optional ALLOWED_ORIGINS.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase. The password is never logged, stored or returned.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const MIN_CODE_LENGTH = 20;
const env = (k: string) => (globalThis as { Deno?: { env: { get(n: string): string | undefined } } }).Deno?.env.get(k);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// ---------- CORS (same rules as supabase/functions/_shared/cors.ts: APP_URL + ALLOWED_ORIGINS, no wildcard) ----------
const ALLOWED_HEADERS = 'authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-region';
function toOrigin(value: string): string | null {
  try {
    const u = new URL(value.trim());
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))) return null;
    return u.origin;
  } catch { return null; }
}
const allowedOrigins = () => new Set([env('APP_URL') ?? '', ...(env('ALLOWED_ORIGINS') ?? '').split(',')].map(toOrigin).filter((o): o is string => o !== null));
const cors = (origin: string) => ({ 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': ALLOWED_HEADERS, 'Access-Control-Max-Age': '600', Vary: 'Origin' });

// ---------- rules ----------
export async function sameSecret(a: string, b: string): Promise<boolean> {          // constant time, via SHA-256 digests
  const enc = new TextEncoder();
  const [x, y] = await Promise.all([crypto.subtle.digest('SHA-256', enc.encode(a)), crypto.subtle.digest('SHA-256', enc.encode(b))]);
  const ax = new Uint8Array(x), ay = new Uint8Array(y); let diff = 0;
  for (let i = 0; i < ax.length; i++) diff |= ax[i]! ^ ay[i]!;
  return diff === 0;
}
// Stricter than the ordinary sign-up rule (10 characters, letters and digits) because this account controls everything.
export function passwordProblem(pw: unknown, email: string): string | null {
  if (typeof pw !== 'string' || pw.length === 0) return 'Choose a password.';
  if (pw.length < 12) return 'The password must have at least 12 characters.';
  if (pw.length > 72) return 'The password can have at most 72 characters.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use both letters and numbers in the password.';
  if (/^(.)\1+$/.test(pw)) return 'The password cannot be one character repeated.';
  const local = email.split('@')[0]!.toLowerCase();
  if (local.length >= 4 && pw.toLowerCase().includes(local)) return 'The password must not contain the email address.';
  return null;
}
const validEmail = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

async function handle(req: Request): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const expected = env('SETUP_CODE') ?? '';
  const email = (env('FIRST_ADMIN_EMAIL') ?? '').trim().toLowerCase();
  if (expected.length < MIN_CODE_LENGTH || !validEmail(email)) {
    return json({ error: 'First-time setup is switched off (SETUP_CODE or FIRST_ADMIN_EMAIL is not set).' }, 503);
  }
  const admin = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  const body = await req.json().catch(() => ({})) as { action?: unknown; setupCode?: unknown; password?: unknown };

  const { data: needed, error: neededErr } = await admin.rpc('first_admin_needed');
  if (neededErr) return json({ error: 'Could not check the setup state. Is the database installed?' }, 500);
  // the /setup page asks first whether setup is open; the answer reveals nothing else (not the address, not the code)
  if (body.action === 'status') return json({ needed: needed === true, enabled: true });
  if (needed !== true) return json({ error: 'Setup is already complete: a Super Administrator exists. Sign in, or use "Forgot password".' }, 409);

  if (typeof body.setupCode !== 'string' || !(await sameSecret(body.setupCode.trim(), expected))) {
    await new Promise((r) => setTimeout(r, 1000));                                  // slow down guessing
    return json({ error: 'That setup code is not right.' }, 403);
  }
  const weak = passwordProblem(body.password, email);
  if (weak) return json({ error: weak }, 400);
  const password = body.password as string;

  // find the account for FIRST_ADMIN_EMAIL (a new project has few accounts; pages of 1000)
  let userId: string | null = null;
  for (let page = 1; page <= 50 && !userId; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return json({ error: 'Could not read the sign-in accounts.' }, 500);
    userId = data.users.find((u) => (u.email ?? '').toLowerCase() === email)?.id ?? null;
    if (data.users.length < 1000) break;
  }
  if (userId) {
    // an existing account must still be an active applicant before anything is changed
    const { data: prof, error } = await admin.from('profiles').select('role, status').eq('id', userId).maybeSingle();
    if (error) return json({ error: 'Could not read the account profile.' }, 500);
    if (!prof || prof.role !== 'applicant' || prof.status !== 'active') {
      return json({ error: 'The account for the first administrator already has another role or is not active. Nothing was changed.' }, 409);
    }
    const { error: upErr } = await admin.auth.admin.updateUserById(userId, { password, email_confirm: true });
    if (upErr) return json({ error: 'Could not set the password.' }, 500);
  } else {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data.user) return json({ error: 'Could not create the administrator account.' }, 500);
    userId = data.user.id;                                                           // the sign-up trigger creates its applicant profile
  }
  const { data: claimed, error: claimErr } = await admin.rpc('claim_first_admin', { p_user: userId });
  if (claimErr) return json({ error: 'Could not complete setup.' }, 500);
  if (claimed !== true) return json({ error: 'The account could not be made Super Administrator (another administrator may have been set up at the same moment).' }, 409);
  return json({ ok: true, email });
}

const serve = (globalThis as { Deno?: { serve(h: (r: Request) => Promise<Response>): void } }).Deno?.serve;
serve?.(async (req: Request) => {
  const origin = req.headers.get('Origin'); const allowed = origin !== null && allowedOrigins().has(origin);
  if (req.method === 'OPTIONS') return allowed ? new Response(null, { status: 204, headers: cors(origin!) }) : new Response(null, { status: 403, headers: { Vary: 'Origin' } });
  if (origin !== null && !allowed) return new Response(JSON.stringify({ error: 'This website address is not allowed to call DIRA LEARN functions' }), { status: 403, headers: { 'Content-Type': 'application/json', Vary: 'Origin' } });
  const res = await handle(req); const headers = new Headers(res.headers);
  if (allowed) for (const [k, v] of Object.entries(cors(origin!))) headers.set(k, v); else headers.append('Vary', 'Origin');
  return new Response(res.body, { status: res.status, headers });
});
