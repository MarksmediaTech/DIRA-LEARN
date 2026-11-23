import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from './AuthProvider';
import { AuthLayout, authButton, authInput } from './AuthLayout';
import { MIN_PASSWORD } from './signupRules';
import {
  CODE_LIFETIME_MINUTES, GENERIC_SENT, MAX_CODE_ATTEMPTS, PROBLEM_MESSAGES, classifyAuthError, cleanCode, clearRecoveryPending, cooldownLeft,
  isCodeShaped, isRecoveryPending, markRecoveryPending, normaliseEmail, validateNewPassword, validateRecoveryEmail,
} from './recoveryRules';

type Step = 'email' | 'code' | 'password';
export const LOGIN_NOTICE_PASSWORD_CHANGED = 'Your password has been changed. Sign in with your new password.';
const SENT_KEY = 'dira.recovery.sentAt';     // when the last code was requested (for the resend cooldown); no secret
const EMAIL_KEY = 'dira.recovery.email';     // which address the code was sent to, so a refresh keeps the screen; no secret

function Alert({ children }: { children: string }) {
  return <p role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm font-medium text-danger"><span aria-hidden>!</span><span>{children}</span></p>;
}
function Spinner() { return <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />; }
const readStr = (k: string): string | null => { try { return window.sessionStorage.getItem(k); } catch { return null; } };
const readNum = (k: string): number | null => { try { const v = window.sessionStorage.getItem(k); return v ? Number(v) : null; } catch { return null; } };
const write = (k: string, v: string | null) => { try { if (v === null) window.sessionStorage.removeItem(k); else window.sessionStorage.setItem(k, v); } catch { /* storage unavailable */ } };

/** Forgot password: email -> code from the email -> new password -> back to sign in. Works the same for every role. */
export function ForgotPasswordPage() {
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState(() => readStr(EMAIL_KEY) ?? '');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState(''); const [confirm, setConfirm] = useState(''); const [show, setShow] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [sentAt, setSentAt] = useState<number | null>(() => readNum(SENT_KEY));
  const [now, setNow] = useState(() => Date.now());
  const wait = cooldownLeft(sentAt, now);

  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, []);
  // A verified recovery (this tab or another) continues at the new-password step; a refresh after requesting a code continues at the code step.
  useEffect(() => {
    if (loading) return;
    if (session && isRecoveryPending()) { setStep('password'); return; }
    if (step === 'password' && !session) { setStep('email'); setError(PROBLEM_MESSAGES.session_missing); clearRecoveryPending(); return; }
    if (step === 'email' && !session && readNum(SENT_KEY) !== null && email) { setStep('code'); setInfo(GENERIC_SENT); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, session]);

  async function requestCode(): Promise<void> {
    const addr = normaliseEmail(email);
    setBusy(true); setError(null);
    const { error: err } = await supabase.auth.resetPasswordForEmail(addr);
    setBusy(false);
    // Same message whatever happened (sent, unknown address, or too soon), so the screen never reveals who has an account.
    // Only a network failure is reported, because then nothing was sent to anyone.
    if (err && classifyAuthError(err) === 'network') { setError(PROBLEM_MESSAGES.network); return; }
    const t = Date.now(); setSentAt(t); write(SENT_KEY, String(t)); write(EMAIL_KEY, addr);
    setEmail(addr); setAttempts(0); setCode(''); setInfo(GENERIC_SENT); setStep('code');
  }

  async function onEmail(e: FormEvent) {
    e.preventDefault();
    const p = validateRecoveryEmail(email); if (p) { setError(p); return; }
    if (wait > 0 && normaliseEmail(email) === (readStr(EMAIL_KEY) ?? '')) { setInfo(GENERIC_SENT); setStep('code'); return; }
    await requestCode();
  }

  async function onCode(e: FormEvent) {
    e.preventDefault();
    if (attempts >= MAX_CODE_ATTEMPTS) { setError('Too many wrong codes. Ask for a new code below.'); return; }
    if (!isCodeShaped(code)) { setError('Enter the 6-digit code from the email.'); return; }
    setBusy(true); setError(null);
    const { data, error: err } = await supabase.auth.verifyOtp({ email: normaliseEmail(email), token: cleanCode(code), type: 'recovery' });
    setBusy(false); setCode('');
    if (err || !data.session) {
      const kind = classifyAuthError(err);
      setAttempts((n) => n + 1);
      setError(kind === 'rate_limited' || kind === 'network' ? PROBLEM_MESSAGES[kind] : PROBLEM_MESSAGES.invalid_code);
      return;
    }
    markRecoveryPending(); write(SENT_KEY, null);
    setInfo(null); setStep('password');
  }

  async function onPassword(e: FormEvent) {
    e.preventDefault();
    const addr = session?.user.email ?? normaliseEmail(email);
    const p = validateNewPassword(password, confirm, addr); if (p) { setError(p); return; }
    setBusy(true); setError(null);
    const { error: err } = await supabase.auth.updateUser({ password });
    if (err) { setBusy(false); setError(PROBLEM_MESSAGES[classifyAuthError(err)]); return; }
    // Sign out everywhere: the recovery session ends and any other signed-in device must use the new password.
    await supabase.auth.signOut({ scope: 'global' });
    clearRecoveryPending(); write(EMAIL_KEY, null); write(SENT_KEY, null);
    setBusy(false); setPassword(''); setConfirm('');
    navigate('/login', { replace: true, state: { notice: LOGIN_NOTICE_PASSWORD_CHANGED } });
  }

  async function backToLogin() {
    if (step === 'password' || isRecoveryPending()) await supabase.auth.signOut();   // never leave a recovery session behind
    clearRecoveryPending(); write(EMAIL_KEY, null); write(SENT_KEY, null);
    navigate('/login', { replace: true });
  }
  const back = <button type="button" onClick={() => { void backToLogin(); }} className="mt-6 text-sm font-semibold text-dira-royal underline-offset-4 hover:underline">Back to sign in</button>;

  if (loading) return <AuthLayout title="One moment…"><p role="status">Loading…</p></AuthLayout>;

  if (step === 'email') return (
    <AuthLayout title="Forgot your password?" subtitle="Enter the email address you use for DIRA LEARN. We will email you a code to reset your password.">
      <form onSubmit={onEmail} className="grid gap-5" noValidate>
        <label className="grid gap-1.5 text-sm font-semibold">Email address
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.org" className={authInput} />
        </label>
        {error && <Alert>{error}</Alert>}
        <button type="submit" disabled={busy} className={authButton}>{busy && <Spinner />}{busy ? 'Sending…' : 'Send reset code'}</button>
      </form>
      {back}
    </AuthLayout>
  );

  if (step === 'code') return (
    <AuthLayout title="Check your email" subtitle={`Enter the code we sent to ${email}. It works for ${CODE_LIFETIME_MINUTES} minutes and only once.`}>
      {info && <p role="status" className="mb-5 rounded-xl bg-dira-lavender/50 p-3 text-sm text-dira-deep/80">{info}</p>}
      <form onSubmit={onCode} className="grid gap-5" noValidate>
        <label className="grid gap-1.5 text-sm font-semibold">Reset code
          <input inputMode="numeric" autoComplete="one-time-code" maxLength={12} required value={code} onChange={(e) => setCode(e.target.value)}
            placeholder="123456" className={`${authInput} tracking-[0.4em]`} aria-describedby="code-help" />
          <span id="code-help" className="text-xs font-normal text-dira-deep/60">The code is in the email titled "Your DIRA LEARN password reset code".</span>
        </label>
        {error && <Alert>{error}</Alert>}
        <button type="submit" disabled={busy || attempts >= MAX_CODE_ATTEMPTS} className={authButton}>{busy && <Spinner />}{busy ? 'Checking…' : 'Verify code'}</button>
      </form>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
        <button type="button" disabled={busy || wait > 0} onClick={() => { void requestCode(); }}
          className="font-semibold text-dira-orange underline-offset-4 hover:underline disabled:cursor-not-allowed disabled:text-dira-deep/40 disabled:no-underline">
          {wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
        </button>
        <button type="button" onClick={() => { setStep('email'); setError(null); setInfo(null); }} className="font-semibold text-dira-royal underline-offset-4 hover:underline">Use a different email</button>
      </div>
      {back}
    </AuthLayout>
  );

  return (
    <AuthLayout title="Choose a new password" subtitle={`Code verified for ${session?.user.email ?? email}. Your new password replaces the old one.`}>
      <form onSubmit={onPassword} className="grid gap-5" noValidate>
        <div className="grid gap-1.5">
          <label htmlFor="fp-password" className="text-sm font-semibold">New password <span className="font-normal text-dira-deep/60">(at least {MIN_PASSWORD} characters, letters and numbers)</span></label>
          <div className="relative">
            <input id="fp-password" type={show ? 'text' : 'password'} autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={`${authInput} pr-20`} />
            <button type="button" onClick={() => setShow(!show)} aria-pressed={show} aria-controls="fp-password fp-confirm" className="absolute inset-y-1.5 right-1.5 rounded-lg px-3 text-xs font-semibold text-dira-royal transition hover:bg-dira-lavender/60">
              {show ? 'Hide' : 'Show'}<span className="sr-only"> passwords</span>
            </button>
          </div>
        </div>
        <label className="grid gap-1.5 text-sm font-semibold">Confirm new password
          <input id="fp-confirm" type={show ? 'text' : 'password'} autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className={authInput} />
        </label>
        {error && <Alert>{error}</Alert>}
        <button type="submit" disabled={busy} className={authButton}>{busy && <Spinner />}{busy ? 'Saving…' : 'Save new password'}</button>
      </form>
      {back}
    </AuthLayout>
  );
}

/** Shown on the sign-in page after a successful reset. */
export function LoginNotice({ text }: { text: string }) {
  return <p role="status" className="rounded-xl border border-ok/30 bg-ok/5 p-3 text-sm font-medium text-ok">{text}</p>;
}
