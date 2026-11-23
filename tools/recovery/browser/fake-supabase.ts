// SIMULATED Supabase client for the browser harness. It reproduces the documented Supabase Auth recovery behaviour
// (codes by email, expiry, single use, replaced by a newer code, once-a-minute requests, verification rate limit, no account
// disclosure, password rules, global sign-out) so the screens can be tested in a real browser here. The real Supabase Auth is
// tested by tools/recovery/recovery_check.mjs and e2e/password-recovery.spec.ts on a computer with local Supabase.
type User = { id: string; email: string; password: string; role: string };
type Code = { code: string; sentAt: number; used: boolean };
type Session = { access_token: string; amr?: string; user: { id: string; email: string; app_metadata?: Record<string, unknown> } };
const W = window as unknown as { __auth: ReturnType<typeof makeState> };
function makeState() {
  return { users: [] as User[], codes: new Map<string, Code>(), outbox: [] as { to: string; subject: string; body: string }[], verifyLog: [] as number[],
           revoked: new Set<string>(), expirySeconds: 900, maxFrequencySeconds: 60, verifyLimit: 30, updates: [] as string[],
           // registration and email verification (auth-flow tests)
           profiles: new Map<string, { role: string; status: string }>(), profileTrigger: true, verifyTokens: new Map<string, string>(),
           confirmed: new Set<string>(), setup: { code: 'correct-setup-code-123456', email: 'marksmedia.studios@gmail.com', enabled: true }, invokes: [] as string[], importMode: 'ok' as 'ok' | 'unreachable' | 'forbidden' | 'html502' | 'unexpected', importCalls: [] as unknown[],
           meta: new Map<string, Record<string, unknown>>(), participants: [] as { profile_id: string; programme_track_id: string }[], enrolMode: 'ok' as 'ok' | 'down', profileMode: 'ok' as 'ok' | 'error42703' | 'reject' | 'hang' | 'inactive' | 'forbidden' | 'expired', profileQueries: 0 };
}
W.__auth = W.__auth ?? makeState();
const S = () => W.__auth;
// server-only account data (app_metadata); a state restored from JSON by a test turns the Map into a plain object
const META = () => (S().meta instanceof Map ? S().meta : (S().meta = new Map()));
const err = (status: number, code: string, message: string, name = 'AuthApiError') => ({ name, status, code, message });
let listeners: ((e: string, s: Session | null) => void)[] = [];
const readSession = (): Session | null => { const s = localStorage.getItem('fake-session'); const v = s ? JSON.parse(s) as Session : null; return v && !S().revoked.has(v.access_token) ? v : null; };
const setSession = (s: Session | null, ev: string) => { if (s) localStorage.setItem('fake-session', JSON.stringify(s)); else localStorage.removeItem('fake-session'); listeners.forEach((l) => l(ev, s)); };
const newSession = (u: User, amr = 'password'): Session => ({ access_token: 'tok-' + Math.random().toString(36).slice(2), amr, user: { id: u.id, email: u.email, app_metadata: { ...(META().get(u.id) ?? {}) } } });
(window as unknown as { __inviteLanding: (id: string) => void }).__inviteLanding = (id) => { const u = S().users.find((x) => x.id === id)!; S().confirmed.add(id); setSession(newSession(u, 'otp'), 'SIGNED_IN'); };   // as the invitation link does: a session without a password
const strong = (p: string) => p.length >= 10 && /[A-Za-z]/.test(p) && /\d/.test(p);

const hash = new URLSearchParams(location.hash.slice(1));
const landed = hash.get('access_token');
if (landed && S().verifyTokens.has(landed)) {
  const uid = S().verifyTokens.get(landed)!; S().verifyTokens.delete(landed); S().confirmed.add(uid);
  const u = S().users.find((x) => x.id === uid)!;
  localStorage.setItem('fake-session', JSON.stringify({ access_token: 'tok-' + Math.random().toString(36).slice(2), user: { id: u.id, email: u.email } }));
  history.replaceState(null, '', location.pathname + location.search);
}

export const __emitTokenRefreshed = () => { const c = readSession(); if (c) setSession({ ...c, access_token: c.access_token + 'r' }, 'TOKEN_REFRESHED'); };
(window as unknown as { __refresh: () => void }).__refresh = __emitTokenRefreshed;

export const supabase = {
  auth: {
    async getSession() { return { data: { session: readSession() }, error: null }; },
    onAuthStateChange(cb: (e: string, s: Session | null) => void) { listeners.push(cb); return { data: { subscription: { unsubscribe() { listeners = listeners.filter((l) => l !== cb); } } } }; },
    async signUp({ email, password, options }: { email: string; password: string; options?: { emailRedirectTo?: string } }) {
      // Supabase with "Confirm email" on: no session; an email with a verification link; the database trigger creates the profile.
      if (!strong(password)) return { data: { user: null, session: null }, error: err(422, 'weak_password', 'Password is too weak') };
      if (S().users.some((x) => x.email === email)) return { data: { user: null, session: null }, error: null };   // no disclosure
      const u = { id: 'u-' + Math.random().toString(36).slice(2), email, password, role: '' }; S().users.push(u);
      if (S().profileTrigger) S().profiles.set(u.id, { role: 'applicant', status: 'active' });
      const t = 'verify-' + Math.random().toString(36).slice(2); S().verifyTokens.set(t, u.id);
      S().outbox.push({ to: email, subject: 'Confirm your signup', body: `${options?.emailRedirectTo ?? location.origin}#access_token=${t}&refresh_token=r&expires_in=3600&token_type=bearer&type=signup` });
      return { data: { user: { id: u.id, email }, session: null }, error: null };
    },
    async signInWithPassword({ email, password }: { email: string; password: string }) {
      const u = S().users.find((x) => x.email === email.trim().toLowerCase() && x.password === password);
      if (!u) return { data: { session: null }, error: err(400, 'invalid_credentials', 'Invalid login credentials') };
      if (!u.role && !S().confirmed.has(u.id)) return { data: { session: null }, error: err(400, 'email_not_confirmed', 'Email not confirmed') };
      const s = newSession(u); setSession(s, 'SIGNED_IN'); return { data: { session: s, user: s.user }, error: null };
    },
    async signOut(o?: { scope?: string }) {
      const s = readSession();
      if (s && o?.scope === 'global') S().revoked.add('ALL:' + s.user.id);
      if (s) S().revoked.add(s.access_token);
      setSession(null, 'SIGNED_OUT'); return { error: null };
    },
    async resetPasswordForEmail(email: string) {
      const u = S().users.find((x) => x.email === email);
      if (!u) return { data: {}, error: null };                                   // unknown address: same success response
      const prev = S().codes.get(u.email);
      if (prev && Date.now() - prev.sentAt < S().maxFrequencySeconds * 1000) return { data: {}, error: err(429, 'over_email_send_rate_limit', 'For security purposes, you can only request this after 60 seconds.') };
      const code = String(Math.floor(100000 + Math.random() * 900000));
      S().codes.set(u.email, { code, sentAt: Date.now(), used: false });            // a newer code replaces the older one
      S().outbox.push({ to: u.email, subject: 'Your DIRA LEARN password reset code', body: `Your code is ${code}` });
      return { data: {}, error: null };
    },
    async verifyOtp({ email, token, type }: { email: string; token: string; type: string }) {
      const now = Date.now(); S().verifyLog = S().verifyLog.filter((t) => now - t < 300_000); S().verifyLog.push(now);
      if (S().verifyLog.length > S().verifyLimit) return { data: { session: null, user: null }, error: err(429, 'over_request_rate_limit', 'Request rate limit reached') };
      const u = S().users.find((x) => x.email === email); const c = u && S().codes.get(u.email);
      if (type !== 'recovery' || !u || !c || c.used || c.code !== token || now - c.sentAt > S().expirySeconds * 1000)
        return { data: { session: null, user: null }, error: err(403, 'otp_expired', 'Token has expired or is invalid') };
      c.used = true;
      const s = newSession(u); setSession(s, 'SIGNED_IN'); return { data: { session: s, user: s.user }, error: null };
    },
    async updateUser({ password }: { password: string }) {
      const s = readSession();
      if (!s || S().revoked.has('ALL:' + s.user.id)) return { data: { user: null }, error: err(400, '', 'Auth session missing!', 'AuthSessionMissingError') };
      const u = S().users.find((x) => x.id === s.user.id)!;
      if (!strong(password)) return { data: { user: null }, error: err(422, 'weak_password', 'Password is too weak') };
      if (password === u.password) return { data: { user: null }, error: err(422, 'same_password', 'New password should be different from the old password.') };
      u.password = password; S().updates.push(u.email); return { data: { user: s.user }, error: null };
    },
  },
  // Edge Function bootstrap-first-admin, simulated with the same answers as the real one (tested in tools/edge-browser).
  functions: {
    async invoke(name: string, { body }: { body: { action?: string; setupCode?: string; password?: string; rows?: { name: string; email: string; programme_track: string }[] } }) {
      S().invokes.push(name + ':' + (body.action ?? 'claim'));
      const fail = (status: number, error: string) => ({ data: null, error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: new Response(JSON.stringify({ error }), { status }) } });
      // import-learners / complete-enrolment (22 Nov 2026), with the three error types supabase-js returns
      const fetchFail = () => ({ data: null, error: { name: 'FunctionsFetchError', message: 'Failed to send a request to the Edge Function', context: new TypeError('Failed to fetch') } });
      if (name === 'import-learners') {
        S().importCalls.push(body);
        const m = S().importMode;
        if (m === 'unreachable') return fetchFail();
        if (m === 'forbidden') return fail(403, 'Forbidden');
        if (m === 'html502') return { data: null, error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code', context: new Response('<html>Bad gateway</html>', { status: 502 }) } };
        if (m === 'unexpected') return { data: 'OK', error: null };
        const ex = (S() as unknown as { existingEmails?: string[] }).existingEmails ?? []; const pend = (S() as unknown as { pendingEmails?: string[] }).pendingEmails ?? [];
        const rows = (body.rows ?? []).map((r, i) => ex.includes(r.email) ? { rowNo: i + 2, email: r.email, outcome: 'already_registered', message: null }
          : { rowNo: i + 2, email: r.email, outcome: 'invited', message: pend.includes(r.email) ? 'Already invited earlier, not yet activated' : null });
        const n = (o: string) => rows.filter((r) => r.outcome === o).length;
        return { data: { batchId: 'b1', invited: n('invited'), alreadyRegistered: n('already_registered'), failed: 0, rows }, error: null };
      }
      if (name === 'complete-enrolment') {
        if (S().enrolMode === 'down') return fetchFail();
        const s = readSession(); if (!s) return fail(401, 'Not signed in');
        const meta = META().get(s.user.id) as { dira_enrolment?: { track_id: string; completed_at?: string } } | undefined;
        if (!meta?.dira_enrolment) return fail(403, 'This account was not added by a learner import, so it follows the normal application process.');
        if (s.amr !== 'password') return fail(403, 'Set your password first, then sign in with it.');
        const p = S().profiles.get(s.user.id)!;
        if (!S().participants.some((x) => x.profile_id === s.user.id)) S().participants.push({ profile_id: s.user.id, programme_track_id: meta.dira_enrolment.track_id });
        p.role = 'participant'; meta.dira_enrolment.completed_at = new Date().toISOString();
        return { data: { enrolled: true }, error: null };
      }
      if (name !== 'bootstrap-first-admin') return fail(404, 'not found');
      const st = S().setup; if (!st.enabled) return fail(503, 'First-time setup is switched off (SETUP_CODE or FIRST_ADMIN_EMAIL is not set).');
      const needed = !S().users.some((u) => u.role === 'super_admin');
      if (body.action === 'status') return { data: { needed, enabled: true }, error: null };
      if (!needed) return fail(409, 'Setup is already complete: a Super Administrator exists. Sign in, or use "Forgot password".');
      if (body.setupCode !== st.code) return fail(403, 'That setup code is not right.');
      const pw = body.password ?? ''; if (pw.length < 12 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return fail(400, 'The password must have at least 12 characters.');
      const existing = S().users.find((u) => u.email === st.email);
      if (existing) { existing.password = pw; existing.role = 'super_admin'; } else S().users.push({ id: 'u-first-admin', email: st.email, password: pw, role: 'super_admin' });
      return { data: { ok: true, email: st.email }, error: null };
    },
  },
  from(table: string) {
    let mode: 'many' | 'single' | 'maybe' = 'many';
    const q = { _id: '', select() { return q; }, eq(_c: string, v: string) { q._id = v; return q; }, single() { mode = 'single'; return q; }, maybeSingle() { mode = 'maybe'; return q; },
      order() { return q; }, limit() { return q; },
      then(res: (r: { data: unknown; error: unknown }) => void, rej?: (e: unknown) => void) {
        if (table === 'tracks') { res({ data: [{ id: 't-dm', name: 'Digital Marketing', position: 1 }, { id: 't-ai', name: 'AI Tools', position: 2 }, { id: 't-cc', name: 'Content Creation', position: 3 }, { id: 't-eb', name: 'Entrepreneurship & Business', position: 4 }], error: null }); return; }
        if (table === 'import_batches') { res({ data: [], error: null }); return; }
        if (table !== 'profiles') { res({ data: null, error: null }); return; }
        S().profileQueries++;
        const m = S().profileMode;
        if (m === 'hang') return;                                                     // the request never answers
        if (m === 'reject') { const e = new TypeError('Failed to fetch'); if (rej) rej(e); return; }
        if (m === 'error42703') { res({ data: null, error: { code: '42703', message: 'column profiles.organization_id does not exist' } }); return; }
        // HTTP 403 as returned in production on 21 Nov 2026 (missing table grant), and an expired access token (HTTP 401)
        if (m === 'forbidden') { res({ data: null, error: { code: '42501', message: 'permission denied for table profiles' } }); return; }
        if (m === 'expired') { res({ data: null, error: { code: 'PGRST301', message: 'JWT expired' } }); return; }
        if (m === 'inactive') { res({ data: null, error: { code: '42501', message: 'DIRA_ACCOUNT_INACTIVE' } }); return; }
        const u = S().users.find((x) => x.id === q._id);
        const p = u ? (S().profiles.get(u.id) ?? (u.role ? { role: u.role, status: 'active' } : null)) : null;   // seeded staff have a role
        const row = p ? { id: u!.id, role: p.role, status: p.status, first_name: 'Test', last_name: 'User', organization_id: null } : null;
        if (!row && mode === 'single') { res({ data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } }); return; }
        res({ data: row, error: null });
      } };
    return q;
  },
};
(window as unknown as { __signOut: () => Promise<unknown> }).__signOut = () => supabase.auth.signOut();
