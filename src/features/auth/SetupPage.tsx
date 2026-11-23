import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from './AuthProvider';
import { AuthLayout, authButton, authInput } from './AuthLayout';
import { ADMIN_MIN_PASSWORD, adminPasswordProblem, functionStatus, readFunctionError, setupCodeProblem } from './setupRules';

type SetupState = 'checking' | 'open' | 'complete' | 'off' | 'failed';

/**
 * First-time setup (21 Nov 2026). The person installing DIRA LEARN opens /setup, enters the one-time setup code (the SETUP_CODE
 * secret) and chooses the first Super Administrator's password. The Edge Function bootstrap-first-admin creates the account for
 * the address in the FIRST_ADMIN_EMAIL secret (it cannot be chosen here), makes it Super Administrator and this page signs in.
 * Nobody needs to sign up first and no database record is edited by hand. Once an administrator exists the page does nothing.
 */
export function SetupPage() {
  const { signIn } = useAuth();
  const [state, setState] = useState<SetupState>('checking');
  const [code, setCode] = useState(''); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ email: string; signedIn: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void supabase.functions.invoke('bootstrap-first-admin', { body: { action: 'status' } }).then(({ data, error: e }) => {
      if (cancelled) return;
      if (e) { setState(functionStatus(e) === 503 ? 'off' : 'failed'); return; }
      setState((data as { needed?: unknown } | null)?.needed === true ? 'open' : 'complete');
    });
    return () => { cancelled = true; };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const problem = setupCodeProblem(code) ?? adminPasswordProblem(password, confirm);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null);
    const { data, error: err } = await supabase.functions.invoke('bootstrap-first-admin', { body: { setupCode: code.trim(), password } });
    if (err) { setError(await readFunctionError(err)); setBusy(false); if (functionStatus(err) === 409) setState('complete'); return; }
    const email = String((data as { email?: unknown } | null)?.email ?? '');
    const signInError = email ? await signIn(email, password) : 'no address';
    setPassword(''); setConfirm(''); setCode(''); setBusy(false);
    setDone({ email, signedIn: signInError === null });
  }

  if (done) {
    return (
      <AuthLayout title="Setup is complete">
        <p role="status" className="text-dira-deep/80">
          <strong>{done.email}</strong> is now the Super Administrator of DIRA LEARN.
          {done.signedIn ? ' You are signed in.' : ' Sign in with that address and the password you just chose.'}
        </p>
        <p className="mt-3 text-sm text-dira-deep/80">Last step: remove the <strong>SETUP_CODE</strong> secret in Supabase (Edge Functions → Secrets). Setup is then switched off for good.</p>
        {/* a normal link reloads the app, so the new role is picked up */}
        <a href={done.signedIn ? '/' : '/login'} className={`${authButton} mt-6`}>{done.signedIn ? 'Continue to DIRA LEARN' : 'Go to sign in'}</a>
      </AuthLayout>
    );
  }
  if (state === 'checking') return <AuthLayout title="First-time setup"><p role="status" className="text-dira-deep/80">Checking…</p></AuthLayout>;
  if (state === 'failed') return <AuthLayout title="First-time setup"><p role="alert" className="text-danger">Could not check the setup state. Check that the database is installed and the function bootstrap-first-admin is deployed, then refresh the page.</p></AuthLayout>;
  if (state === 'off') {
    return (
      <AuthLayout title="Setup is switched off">
        <p className="text-dira-deep/80">First-time setup is not switched on (the SETUP_CODE or FIRST_ADMIN_EMAIL secret is not set). If DIRA LEARN already has an administrator, sign in.</p>
        <Link to="/login" className="mt-6 inline-block text-sm font-semibold text-dira-royal underline-offset-4 hover:underline">Go to sign in</Link>
      </AuthLayout>
    );
  }
  if (state === 'complete') {
    return (
      <AuthLayout title="Setup is already complete">
        <p className="text-dira-deep/80">DIRA LEARN already has a Super Administrator. Sign in, or use “Forgot password” if you cannot remember the password.</p>
        {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
        <div className="mt-6 flex gap-4">
          <Link to="/login" className="text-sm font-semibold text-dira-royal underline-offset-4 hover:underline">Sign in</Link>
          <Link to="/forgot-password" className="text-sm font-semibold text-dira-royal underline-offset-4 hover:underline">Forgot password</Link>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="First-time setup" subtitle="Create the first Super Administrator of DIRA LEARN.">
      <form onSubmit={onSubmit} className="grid gap-5" noValidate>
        <p className="text-sm text-dira-deep/80">The account is created for the address set as <strong>FIRST_ADMIN_EMAIL</strong> in Supabase. You choose its password here.</p>
        <div className="grid gap-1.5">
          <label htmlFor="setup-code" className="text-sm font-semibold">Setup code <span className="font-normal text-dira-deep/60">(the secret you set as SETUP_CODE)</span></label>
          <input id="setup-code" type={show ? 'text' : 'password'} autoComplete="off" required value={code} onChange={(e) => setCode(e.target.value)} className={authInput} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="setup-password" className="text-sm font-semibold">Administrator password <span className="font-normal text-dira-deep/60">(at least {ADMIN_MIN_PASSWORD} characters, letters and numbers)</span></label>
          <input id="setup-password" type={show ? 'text' : 'password'} autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={authInput} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="setup-confirm" className="text-sm font-semibold">Confirm password</label>
          <input id="setup-confirm" type={show ? 'text' : 'password'} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className={authInput} />
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show what I typed</label>
        {error && <p role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm font-medium text-danger"><span aria-hidden>!</span><span>{error}</span></p>}
        <button type="submit" disabled={busy} className={authButton}>{busy ? 'Setting up…' : 'Create the Super Administrator'}</button>
      </form>
    </AuthLayout>
  );
}
