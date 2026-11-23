import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router-dom';
import { ChevronDown, KeyRound, LogOut, Menu, X } from 'lucide-react';
import { NotificationBell } from './NotificationBell';
import { avatarColour, initials } from '@/features/chat/rules';
import logoLight from '@/assets/dira-logo-light.png';
import { SITE_LINKS } from '@/lib/site';
import { useAuth } from '@/features/auth/AuthProvider';
import { groupedNavFor } from '@/lib/permissions';

// Phase 9: grouped menu; on phones a top bar with a Menu button opens the full menu (it used to be one long sideways strip).
// Focus outlines inside the dark menu use the brand orange so keyboard users can see them.
const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center justify-between whitespace-nowrap rounded-control px-3 py-2 text-sm focus-visible:outline-dira-orange ${isActive ? 'bg-white font-semibold text-dira-deep' : 'text-purple-100 hover:bg-white/10'}`;

// 22 Nov 2026: notifications moved from a menu page to the bell at the top right (NotificationBell), next to the profile menu.
/** True on computers and tablets (Tailwind's md breakpoint, 768 px), so the bell is mounted exactly once: in the visible header. */
function useWide(): boolean {
  const q = '(min-width: 768px)';
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && !!window.matchMedia?.(q).matches);
  useEffect(() => {
    const m = window.matchMedia?.(q); if (!m) return;
    const f = () => setWide(m.matches); f(); m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return wide;
}

export function AppShell() {
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const wide = useWide();   // one bell = one Realtime subscription and one set of pop-ups
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!profile) return null;
  const groups = groupedNavFor(profile.role);
  const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ') || 'My account';

  return (
    <div className="min-h-screen md:grid md:grid-cols-[248px_1fr] print:block">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-white focus:px-3 focus:py-2 focus:text-dira-deep">Skip to main content</a>

      {/* phones: top bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between bg-dira-deep px-4 py-3 text-white print:hidden md:hidden">
        <span className="flex items-center gap-2"><img src={logoLight} alt="DIRA Foundation" width={900} height={608} className="h-auto w-20" /><span className="font-display text-xs font-bold tracking-wide text-dira-orange">LEARN</span></span>
        <span className="flex items-center gap-1">
          {!wide && <NotificationBell userId={profile.id} />}
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="main-menu"
            className="flex items-center gap-2 rounded-control px-3 py-2 text-sm focus-visible:outline-dira-orange">
            {open ? <X size={18} aria-hidden /> : <Menu size={18} aria-hidden />} Menu
          </button>
        </span>
      </header>

      <nav id="main-menu" aria-label="Main"
        className={`${open ? 'block' : 'hidden'} bg-dira-deep p-3 text-white print:hidden md:sticky md:top-0 md:flex md:h-screen md:flex-col md:overflow-y-auto md:p-5`}>
        <div className="hidden md:mb-5 md:block"><img src={logoLight} alt="DIRA Foundation" width={900} height={608} className="h-auto w-32" /><p className="mt-2 font-display text-sm font-bold tracking-wide text-dira-orange">LEARN</p></div>
        {groups.map((g) => (
          <div key={g.group} className="mb-3">
            {groups.length > 1 && <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-purple-200/80">{g.group}</p>}
            <ul className="grid gap-0.5">
              {g.items.map((i) => (
                <li key={i.path}>
                  <NavLink to={i.path} end={i.path === '/' || i.path === '/curriculum'} className={linkClass} onClick={() => setOpen(false)}>
                    <span>{i.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="mt-2 grid gap-1 border-t border-white/10 pt-3 md:mt-auto">
          <NavLink to="/account/password" className={linkClass} onClick={() => setOpen(false)}>Change password</NavLink>
          <button type="button" onClick={() => void signOut()} className="flex items-center gap-2 rounded-control px-3 py-2 text-sm text-purple-100 hover:bg-white/10 focus-visible:outline-dira-orange">
            <LogOut size={16} aria-hidden /> Sign out
          </button>
          <a href={SITE_LINKS.home} target="_blank" rel="noopener noreferrer" className="rounded-control px-3 py-2 text-xs text-purple-200 hover:bg-white/10 focus-visible:outline-dira-orange">DIRA Foundation website &#8599;</a>
        </div>
      </nav>

      <div className="min-w-0">
        {/* computers and tablets: the bell and the profile menu at the extreme top right of every page */}
        <header className="sticky top-0 z-40 hidden items-center justify-end gap-2 border-b border-purple-100 bg-white/90 px-8 py-2 backdrop-blur print:hidden md:flex dark:border-gray-800 dark:bg-gray-950/90">
          {wide && <NotificationBell userId={profile.id} />}
          <ProfileMenu name={name} id={profile.id} onSignOut={() => void signOut()} />
        </header>
        <main id="main" tabIndex={-1} className="min-w-0 p-4 sm:p-5 md:p-8"><Outlet /></main>
      </div>
    </div>
  );
}

function ProfileMenu({ name, id, onSignOut }: { name: string; id: string; onSignOut: () => void }) {
  const [open, setOpen] = useState(false); const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu" className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 text-sm hover:bg-purple-50 dark:text-gray-100 dark:hover:bg-gray-800">
        <span aria-hidden className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-white ${avatarColour(id)}`}>{initials(name)}</span>
        <span className="max-w-[10rem] truncate font-medium">{name}</span><ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-full mt-2 grid w-52 gap-0.5 rounded-2xl border border-purple-100 bg-white p-1.5 text-sm shadow-xl dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
          <Link role="menuitem" to="/account/password" onClick={() => setOpen(false)} className="flex items-center gap-2 rounded-xl px-3 py-2 hover:bg-purple-50 dark:hover:bg-gray-800"><KeyRound size={16} aria-hidden /> Change password</Link>
          <button role="menuitem" type="button" onClick={onSignOut} className="flex items-center gap-2 rounded-xl px-3 py-2 text-left hover:bg-purple-50 dark:hover:bg-gray-800"><LogOut size={16} aria-hidden /> Sign out</button>
        </div>
      )}
    </div>
  );
}
