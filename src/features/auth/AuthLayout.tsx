import type { ReactNode } from 'react';
import logoDark from '@/assets/dira-logo.png';
import { SITE_LINKS } from '@/lib/site';
import { AuthBackdrop } from '@/components/ui/PhotoStage';

/** Shared frame for the account pages (create account, set password): animated website photos under the deep purple theme, white card, DIRA logo, footer. */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="relative isolate flex min-h-screen flex-col overflow-hidden bg-dira-deep text-white">
      <AuthBackdrop wash="centre" />
      <main className="mx-auto grid w-full flex-1 place-items-center px-6 py-10">
        <div className="animate-rise-in w-full max-w-md rounded-3xl bg-white p-8 text-dira-deep shadow-[0_30px_80px_-20px_rgba(0,0,0,0.65)] ring-1 ring-white/20 sm:p-10">
          <img src={logoDark} alt="DIRA Foundation" width={900} height={608} className="h-auto w-36" />
          <h1 className="mt-6 text-3xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-dira-deep/70">{subtitle}</p>}
          <div className="mt-7">{children}</div>
        </div>
      </main>
      <footer className="px-6 pb-6 pt-2 text-center text-xs text-white/60">
        <p className="font-semibold tracking-[0.2em] text-dira-orange">Education • Empowerment • Opportunity</p>
        <p className="mt-1.5">© 2026 DIRA Foundation. All rights reserved.</p>
        <p className="mt-2"><a href={SITE_LINKS.home} className="underline underline-offset-4 hover:text-white">Back to the DIRA Foundation website</a></p>
      </footer>
    </div>
  );
}

export const authInput =
  'w-full rounded-xl border border-dira-lavender bg-white px-4 py-3 text-[15px] text-dira-deep placeholder:text-dira-deep/40 shadow-sm transition ' +
  'hover:border-dira-royal/50 focus:border-dira-royal focus:outline-none focus:ring-4 focus:ring-dira-royal/20';
export const authButton =
  'inline-flex w-full items-center justify-center gap-2 rounded-xl bg-dira-primary px-5 py-3.5 text-base font-semibold text-white shadow-lg shadow-dira-primary/30 transition hover:bg-dira-royal disabled:cursor-not-allowed disabled:opacity-60';
