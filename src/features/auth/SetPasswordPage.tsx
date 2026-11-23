import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from './AuthProvider';
import { AuthLayout, authButton, authInput } from './AuthLayout';
import { validatePassword, MIN_PASSWORD } from './signupRules';
import { completeEnrolment, hasPendingEnrolment } from './enrolment';

/**
 * Where an invitation link lands. The link signs the person in; here they choose their password.
 * Learners imported from CSV (22 Nov 2026) are then signed in with the new password and activated as participants at once
 * (complete-enrolment); everyone else (staff invitations) continues exactly as before.
 */
export function SetPasswordPage() {
  const { session, loading, reloadProfile } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);
  const [activation, setActivation] = useState<{ failed: string } | 'activated' | null>(null);

  if (loading) return <AuthLayout title="One moment…"><p role="status">Checking your link…</p></AuthLayout>;
  if (!session) {
    return (
      <AuthLayout title="This link has expired">
        <p className="text-dira-deep/80">The invitation link has expired or was already used. Please ask the DIRA Learn programme team to send you a new one.</p>
        <Link to="/login" className="mt-6 inline-block text-sm font-semibold text-dira-royal underline-offset-4 hover:underline">Go to sign in</Link>
      </AuthLayout>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const problem = validatePassword(password, session?.user.email ?? '') ?? (password !== confirm ? 'The two passwords do not match.' : null);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null);
    const imported = hasPendingEnrolment(session?.user);
    const email = session?.user.email ?? '';
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) { setBusy(false); setError(err.message); return; }
    if (imported) {
      // Activation only after the password is saved: sign in with it (the server requires a password sign-in), then activate.
      const { error: signErr } = await supabase.auth.signInWithPassword({ email, password });
      const r = signErr ? { ok: false as const, message: 'Your password is saved, but signing in with it failed.' } : await completeEnrolment();
      setBusy(false); setPassword(''); setConfirm('');
      if (!r.ok) { setActivation({ failed: r.message }); return; }
      reloadProfile(); setActivation('activated'); setDone(true);
      window.setTimeout(() => navigate('/', { replace: true }), 1500);
      return;
    }
    setBusy(false);
    setDone(true);
    window.setTimeout(() => navigate('/', { replace: true }), 1500);
  }

  async function retryActivation() {
    setBusy(true);
    const r = await completeEnrolment();
    setBusy(false);
    if (!r.ok) { setActivation({ failed: r.message }); return; }
    reloadProfile(); setActivation('activated'); setDone(true);
    window.setTimeout(() => navigate('/', { replace: true }), 1500);
  }

  if (activation && activation !== 'activated') {
    return (
      <AuthLayout title="Password saved">
        <p className="text-dira-deep/80">Your password is set. Your participant account could not be activated yet:</p>
        <p role="alert" className="mt-3 rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm font-medium text-danger">{activation.failed}</p>
        <p className="mt-3 text-sm text-dira-deep/70">Try again now, or simply sign in later with your email and new password: activation is finished automatically.</p>
        <button type="button" disabled={busy} onClick={() => void retryActivation()} className={`${authButton} mt-6`}>{busy ? 'Trying…' : 'Try again'}</button>
      </AuthLayout>
    );
  }
  if (done) return <AuthLayout title="Password saved"><p role="status" className="text-dira-deep/80">{activation === 'activated' ? 'Your password is set and your participant account is active. Taking you to DIRA Learn…' : 'Your password is set. Taking you to DIRA Learn…'}</p></AuthLayout>;
  return (
    <AuthLayout title="Choose your password" subtitle="You will use it with your email address to sign in.">
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        <div className="grid gap-1.5">
          <label htmlFor="sp-password" className="text-sm font-semibold">New password <span className="font-normal text-dira-deep/60">(at least {MIN_PASSWORD} characters, letters and numbers)</span></label>
          <div className="relative">
            <input id="sp-password" type={show ? 'text' : 'password'} autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={`${authInput} pr-20`} />
            <button type="button" onClick={() => setShow(!show)} aria-pressed={show} aria-controls="sp-password" className="absolute inset-y-1.5 right-1.5 rounded-lg px-3 text-xs font-semibold text-dira-royal transition hover:bg-dira-lavender/60">
              {show ? 'Hide' : 'Show'}<span className="sr-only"> password</span>
            </button>
          </div>
        </div>
        <label className="grid gap-1.5 text-sm font-semibold">Confirm password
          <input type={show ? 'text' : 'password'} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className={authInput} />
        </label>
        {error && <p role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm font-medium text-danger"><span aria-hidden>!</span><span>{error}</span></p>}
        <button type="submit" disabled={busy} className={authButton}>
          {busy && <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}{busy ? 'Saving…' : 'Save password'}
        </button>
      </form>
    </AuthLayout>
  );
}
