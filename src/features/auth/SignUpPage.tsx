import { useState, type FormEvent } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from './AuthProvider';
import { AuthLayout, authButton, authInput } from './AuthLayout';
import { validateSignUp, MIN_PASSWORD } from './signupRules';
import { SITE_LINKS } from '@/lib/site';

/** Self-service account creation. New accounts are always applicants (the database decides that, never this page). */
export function SignUpPage() {
  const { session } = useAuth();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const [consent, setConsent] = useState(false); const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [sent, setSent] = useState(false);

  if (session) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const problem = validateSignUp({ email, password, confirm, consent });
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null);
    let err: { message: string } | null;
    try {
      ({ error: err } = await supabase.auth.signUp({ email: email.trim().toLowerCase(), password, options: { emailRedirectTo: `${window.location.origin}/login` } }));
    } catch {
      err = { message: 'We could not reach DIRA LEARN. Check your internet connection and try again.' };   // network failure: never stay on "Creating account…"
    } finally { setBusy(false); }
    if (err) { setError(/rate|too many/i.test(err.message) ? 'Too many attempts. Please wait a few minutes and try again.' : err.message); return; }
    // With email confirmation on, no session is returned. The same message is shown whether or not the address already had an account.
    setSent(true);
  }

  if (sent) {
    return (
      <AuthLayout title="Check your email">
        <p role="status" className="text-dira-deep/80">If this address can be used, we have sent a message to <strong>{email.trim()}</strong>. Open it and follow the link to confirm your account, then sign in and complete your application.</p>
        <p className="mt-4 text-sm text-dira-deep/70">Nothing arrived after a few minutes? Check your spam folder, or contact the DIRA Learn programme team.</p>
        <Link to="/login" className="mt-6 inline-block text-sm font-semibold text-dira-royal underline-offset-4 hover:underline">Back to sign in</Link>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout title="Create your account" subtitle="Start your application to DIRA Learn.">
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        <label className="grid gap-1.5 text-sm font-semibold">Email address
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.org" className={authInput} />
        </label>
        <div className="grid gap-1.5">
          <label htmlFor="su-password" className="text-sm font-semibold">Password <span className="font-normal text-dira-deep/60">(at least {MIN_PASSWORD} characters, letters and numbers)</span></label>
          <div className="relative">
            <input id="su-password" type={show ? 'text' : 'password'} autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={`${authInput} pr-20`} />
            <button type="button" onClick={() => setShow(!show)} aria-pressed={show} aria-controls="su-password" className="absolute inset-y-1.5 right-1.5 rounded-lg px-3 text-xs font-semibold text-dira-royal transition hover:bg-dira-lavender/60">
              {show ? 'Hide' : 'Show'}<span className="sr-only"> password</span>
            </button>
          </div>
        </div>
        <label className="grid gap-1.5 text-sm font-semibold">Confirm password
          <input type={show ? 'text' : 'password'} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className={authInput} />
        </label>
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4 accent-dira-primary" />
          <span>I have read the <a href={SITE_LINKS.privacy} target="_blank" rel="noopener noreferrer" className="font-semibold text-dira-royal underline">Privacy policy</a> and <a href={SITE_LINKS.terms} target="_blank" rel="noopener noreferrer" className="font-semibold text-dira-royal underline">Terms of use</a>, and I agree that DIRA Foundation may store and use my details to process my application and run the programme.</span>
        </label>
        {error && <p role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm font-medium text-danger"><span aria-hidden>!</span><span>{error}</span></p>}
        <button type="submit" disabled={busy} className={authButton}>
          {busy && <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}{busy ? 'Creating account…' : 'Create account'}
        </button>
        <p className="text-center text-sm text-dira-deep/70">Already have an account? <Link to="/login" className="font-semibold text-dira-royal underline-offset-4 hover:underline">Sign in</Link></p>
      </form>
    </AuthLayout>
  );
}
