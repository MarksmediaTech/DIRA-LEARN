import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { HeartHandshake, Mic, Rocket, Users, type LucideIcon } from 'lucide-react';
import { SITE_LINKS, VALUES } from '@/lib/site';
import { isRecoveryPending } from './recoveryRules';
import { LoginNotice } from './ForgotPasswordPage';
import { AuthBackdrop } from '@/components/ui/PhotoStage';
import logoDark from '@/assets/dira-logo.png';
import logoLight from '@/assets/dira-logo-light.png';

const input =
  'w-full rounded-xl border border-dira-lavender bg-white px-4 py-3 text-[15px] text-dira-deep placeholder:text-dira-deep/40 shadow-sm transition ' +
  'hover:border-dira-royal/50 focus:border-dira-royal focus:outline-none focus:ring-4 focus:ring-dira-royal/20';

// The four values from the DIRA Foundation website, each tied to a compass point (North, East, South, West).
const ICONS: LucideIcon[] = [Mic, Rocket, Users, HeartHandshake];

// Sign-in logic is unchanged: useAuth().signIn, the redirect for an existing session, and the error text it returns.
export function LoginPage() {
  const { session, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice ?? null;

  // A verified password recovery must finish (new password) before the account can be used.
  if (session && isRecoveryPending()) return <Navigate to="/forgot-password" replace />;
  if (session) return <Navigate to="/" replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(await signIn(email, password));
    setBusy(false);
  }

  return (
    <div className="relative isolate flex min-h-screen flex-col overflow-hidden bg-dira-deep text-white">
      <AuthBackdrop />

      <div className="mx-auto grid w-full max-w-7xl flex-1 items-center gap-10 px-6 py-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16 lg:px-12">
        <section className="animate-rise-in">
          <img src={logoLight} alt="DIRA Foundation: Your voice, your direction" width={900} height={608} className="h-auto w-48 sm:w-56" />
          <h1 className="mt-6 max-w-xl text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
            Your Journey <span className="text-dira-orange">Starts Here.</span>
          </h1>
          <p className="mt-4 text-lg font-medium text-dira-lavender sm:text-xl">Discover your potential. Build your future.</p>
          <p className="mt-5 hidden max-w-lg leading-relaxed text-white/70 sm:block">
            DIRA Learn is DIRA Foundation&apos;s learning and skills-development platform. Follow your programme, complete your work, and build the skills and confidence to move your life forward.
          </p>
          <ul aria-label="Our values" className="mt-8 grid max-w-xl gap-3 sm:grid-cols-2">
            {VALUES.map((v, i) => {
              const Icon = ICONS[i]!;
              return (
                <li key={v.title} className="animate-float motion-reduce:animate-none" style={{ animationDelay: `${i * 0.9}s` }}>
                  <div className="h-full rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/15 backdrop-blur-sm transition duration-300 hover:-translate-y-1 hover:bg-white/10 hover:ring-dira-orange/50">
                    <div className="flex items-center justify-between">
                      <span aria-hidden className="grid h-9 w-9 place-items-center rounded-xl bg-dira-orange/15 text-dira-orange"><Icon className="h-5 w-5" strokeWidth={2} /></span>
                      <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-dira-lavender/70">{v.point}</span>
                    </div>
                    <h3 className="mt-3 font-display text-base font-bold">{v.title}</h3>
                    <p className="mt-1 text-sm leading-snug text-white/70">{v.text}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <main className="animate-rise-in justify-self-center lg:justify-self-end" style={{ animationDelay: '120ms' }}>
          <div className="w-full max-w-md rounded-3xl bg-white p-8 text-dira-deep shadow-[0_30px_80px_-20px_rgba(0,0,0,0.65)] ring-1 ring-white/20 sm:p-10">
            <img src={logoDark} alt="DIRA Foundation" width={900} height={608} className="h-auto w-36" />
            <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-dira-lavender/60 px-3 py-1 font-display text-sm font-bold tracking-tight text-dira-logo">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-dira-orange" /> DIRA Learn
            </p>
            <h2 className="mt-7 text-3xl font-bold tracking-tight">Welcome Back</h2>
            <p className="mt-1.5 text-dira-deep/70">Sign in to continue your learning journey.</p>

            <form onSubmit={onSubmit} className="mt-7 grid gap-5" noValidate>
              <label className="grid gap-1.5 text-sm font-semibold">Email address
                <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.org" className={input} />
              </label>
              <div className="grid gap-1.5">
                <label htmlFor="login-password" className="text-sm font-semibold">Password</label>
                <div className="relative">
                  <input id="login-password" type={show ? 'text' : 'password'} autoComplete="current-password" required value={password}
                    onChange={(e) => setPassword(e.target.value)} className={`${input} pr-20`} />
                  <button type="button" onClick={() => setShow(!show)} aria-pressed={show} aria-controls="login-password"
                    className="absolute inset-y-1.5 right-1.5 rounded-lg px-3 text-xs font-semibold text-dira-royal transition hover:bg-dira-lavender/60 focus-visible:outline-dira-royal">
                    {show ? 'Hide' : 'Show'}<span className="sr-only"> password</span>
                  </button>
                </div>
              </div>

              <div className="-mt-2 text-right">
                <Link to="/forgot-password" className="text-sm font-semibold text-dira-royal underline-offset-4 hover:underline">Forgot password?</Link>
              </div>
              {notice && <LoginNotice text={notice} />}

              {error && (
                <p role="alert" className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm font-medium text-danger">
                  <span aria-hidden>!</span><span>{error}</span>
                </p>
              )}

              <button type="submit" disabled={busy}
                className="group relative inline-flex items-center justify-center gap-2 rounded-xl bg-dira-primary px-5 py-3.5 text-base font-semibold text-white shadow-lg shadow-dira-primary/30 transition hover:-translate-y-0.5 hover:bg-dira-royal hover:shadow-xl focus-visible:outline-dira-royal disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-70">
                {busy && <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />}
                {busy ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
            <p className="mt-6 text-center text-sm text-dira-deep/70">New to DIRA Learn? <Link to="/signup" className="font-semibold text-dira-royal underline-offset-4 hover:underline">Create an account</Link></p>
          </div>
        </main>
      </div>

      <footer className="px-6 pb-6 pt-2 text-center text-xs text-white/60">
        <p className="font-semibold tracking-[0.2em] text-dira-orange">Education • Empowerment • Opportunity</p>
        <p className="mt-1.5">© 2026 DIRA Foundation. All rights reserved.</p>
        <p className="mt-2"><a href={SITE_LINKS.home} className="underline underline-offset-4 hover:text-white">Back to the DIRA Foundation website</a></p>
      </footer>
    </div>
  );
}
