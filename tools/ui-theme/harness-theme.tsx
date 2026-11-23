// Visual harness for the purple panel theme and the framed photographs (23 Nov 2026): the REAL CoverHero, Button and the real
// class strings used by the dashboard, curriculum, cohort and Import pages, inside a <main> like the app shell. No data needed.
import { createRoot } from 'react-dom/client';
import { CoverHero } from '@/features/dashboard/CoverHero';
import { Button } from '@/components/ui/Button';

const input = 'rounded-control border border-purple-200 px-3 py-2 font-normal';
function Page() {
  return (
    <main id="main" className="min-w-0 p-4 sm:p-5 md:p-8">
      <div className="grid gap-6">
        <CoverHero name="Amina" roleLabel="Trainer" />
        <section data-testid="tiles"><h2 className="mb-3 font-display text-lg font-semibold text-dira-deep">Go to</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {['Curriculum', 'Sessions', 'Calendar', 'Chat'].map((t) => <li key={t}><a href="#x" className="block rounded-card border border-purple-100 bg-white p-4 text-sm font-semibold text-dira-deep shadow-sm">{t}</a></li>)}
          </ul></section>
        <dl className="grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-4">
          {['submitted', 'accepted'].map((s) => <div key={s} className="rounded-card border border-purple-100 p-4"><dt className="text-sm capitalize text-ink/70">{s}</dt><dd className="font-display text-2xl font-bold">12</dd></div>)}
        </dl>
        <ul data-testid="curriculum" className="grid gap-3">
          <li className="rounded-card border border-purple-100 p-4" data-testid="session-card">
            <p className="text-xs font-semibold uppercase text-purple-700">Week 1 · Session 2</p>
            <h3 className="font-display text-lg font-semibold text-purple-900">Understanding your audience</h3>
            <p className="mt-1 text-sm text-ink/70">90 minutes · Shared core</p>
            <span className="mt-2 inline-block rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-700">scheduled</span>{' '}
            <span className="rounded-full bg-ok/10 px-2 py-0.5 text-xs font-semibold text-ok">Approved</span>{' '}
            <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs font-semibold text-warn">Draft</span>
            <p role="alert" className="mt-2 text-sm text-danger">Could not load the lesson plan.</p>
          </li>
        </ul>
        <div data-testid="form-panel" className="grid gap-3 rounded-card border border-purple-100 p-5 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium">Enrol a participant
            <select className={input} defaultValue=""><option value="">Choose a participant</option><option>Brian Njima Otieno (P-0001)</option></select></label>
          <label className="grid gap-1 text-sm font-medium">Programme track
            <select className={input} defaultValue="t1"><option value="">Learner chooses later</option><option value="t1">Digital Marketing</option></select></label>
          <label className="grid gap-1 text-sm font-medium">Name<input className={input} placeholder="Full name" /></label>
          <div className="flex gap-2"><Button>Enrol</Button><Button variant="quiet">Cancel</Button><Button variant="accent">Needs attention</Button></div>
          <div className="rounded-control border-l-4 border-orange-400 bg-orange-50/60 p-3 text-sm text-ink">Staff note on a light surface: <span className="text-ink/70">dark text kept</span>.</div>
        </div>
        <ul data-testid="roster" className="divide-y divide-purple-100 rounded-card border border-purple-100">
          <li className="flex flex-wrap justify-between gap-2 p-3 text-sm"><span>Brian Njima Otieno <span className="text-xs text-ink/60">P-0001</span></span><span className="text-ink/70">Digital Marketing</span></li>
          <li className="flex flex-wrap justify-between gap-2 p-3 text-sm"><span>Mary Wanjiku <span className="text-xs text-ink/60">P-0002</span></span><span className="text-ink/70">Track not chosen yet</span></li>
        </ul>
        <div className="dira-plain"><div data-testid="plain" className="rounded-card border border-purple-100 p-4 text-sm">An opted-out card (dira-plain) is left unthemed.</div></div>
        <p data-testid="banner" className="rounded-card border border-amber-300 bg-amber-50 p-3 text-sm">Warning banner keeps its own colours.</p>
      </div>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(<Page />);
