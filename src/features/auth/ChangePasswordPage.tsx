import { useState, type FormEvent } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from './AuthProvider';
import { authButton, authInput } from './AuthLayout';
import { validateNewPassword } from './recoveryRules';
import { MIN_PASSWORD } from './signupRules';

/**
 * Change password (21 Nov 2026), for every signed-in account, including the first Super Administrator. The current password is
 * checked first (Supabase Auth sign-in with it), then the new one is saved with updateUser. Forgotten passwords use the
 * "Forgot password" page instead. Passwords are never logged or stored by this page.
 */
export function ChangePasswordPage() {
  const { session } = useAuth();
  const email = session?.user.email ?? '';
  const [current, setCurrent] = useState(''); const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false); const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!current) { setError('Enter your current password.'); return; }
    const problem = validateNewPassword(password, confirm, email) ?? (password === current ? 'The new password must be different from the current one.' : null);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null); setDone(false);
    const { error: authErr } = await supabase.auth.signInWithPassword({ email, password: current });
    if (authErr) { setBusy(false); setError('Your current password is not right.'); return; }
    const { error: upErr } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (upErr) {
      const code = (upErr as { code?: string }).code;
      setError(code === 'same_password' ? 'The new password must be different from the current one.'
        : code === 'weak_password' ? 'That password is too weak. Use a longer one with letters and numbers.' : 'The password could not be changed. Please try again.');
      return;
    }
    setCurrent(''); setPassword(''); setConfirm(''); setDone(true);
  }

  const type = show ? 'text' : 'password';
  return (
    <section className="mx-auto max-w-md">
      <h1 className="text-2xl font-bold text-dira-deep">Change password</h1>
      <p className="mt-1 text-sm text-dira-deep/70">For <strong>{email}</strong>. Forgotten it? Sign out and use “Forgot password”.</p>
      <form onSubmit={onSubmit} className="mt-6 grid gap-5" noValidate>
        <div className="grid gap-1.5">
          <label htmlFor="cp-current" className="text-sm font-semibold">Current password</label>
          <input id="cp-current" type={type} autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={authInput} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="cp-new" className="text-sm font-semibold">New password <span className="font-normal text-dira-deep/60">(at least {MIN_PASSWORD} characters, letters and numbers)</span></label>
          <input id="cp-new" type={type} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={authInput} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="cp-confirm" className="text-sm font-semibold">Confirm new password</label>
          <input id="cp-confirm" type={type} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={authInput} />
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show passwords</label>
        {error && <p role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm font-medium text-danger">{error}</p>}
        {done && <p role="status" className="rounded-xl border border-ok/30 bg-ok/5 p-3 text-sm font-medium text-ok">Your password has been changed.</p>}
        <button type="submit" disabled={busy} className={authButton}>{busy ? 'Saving…' : 'Change password'}</button>
      </form>
    </section>
  );
}
