// Minimal stand-in for react-router-dom (test harness only; the app uses the real package). History API based.
// Supports what the screens use: Routes/Route (exact paths, layout routes), Navigate, Link, NavLink (active class),
// useNavigate (string or { pathname, search }), useLocation, useSearchParams, Outlet.
import { createContext, useContext, useEffect, useState, type ReactElement, type ReactNode } from 'react';
type Loc = { pathname: string; search: string; state: unknown };
type To = string | { pathname?: string; search?: string };
type Opts = { replace?: boolean; state?: unknown };
const Ctx = createContext<{ loc: Loc; go: (to: To, o?: Opts) => void } | null>(null);
const OutletCtx = createContext<ReactNode>(null);
const ParamsCtx = createContext<Record<string, string>>({});
export const useParams = () => useContext(ParamsCtx);
// '/cohorts/:id' matches '/cohorts/abc' with { id: 'abc' }
const fit = (pattern: string, path: string): Record<string, string> | null => { const a = pattern.split('/'), b = path.split('/'); if (a.length !== b.length) return null; const out: Record<string, string> = {}; for (let i = 0; i < a.length; i++) { if (a[i]!.startsWith(':')) out[a[i]!.slice(1)] = decodeURIComponent(b[i]!); else if (a[i] !== b[i]) return null; } return out; };
const here = (): Loc => ({ pathname: location.pathname, search: location.search, state: history.state?.usr ?? null });
const href = (to: To, cur: Loc) => typeof to === 'string' ? to : `${to.pathname ?? cur.pathname}${to.search ? (to.search.startsWith('?') ? to.search : '?' + to.search) : ''}`;
export function BrowserRouter({ children }: { children: ReactNode }) {
  const [loc, setLoc] = useState<Loc>(here);
  useEffect(() => { const f = () => setLoc(here()); addEventListener('popstate', f); return () => removeEventListener('popstate', f); }, []);
  const go = (to: To, o: Opts = {}) => { (o.replace ? history.replaceState : history.pushState).call(history, { usr: o.state ?? null }, '', href(to, here())); setLoc(here()); };
  return <Ctx.Provider value={{ loc, go }}>{children}</Ctx.Provider>;
}
export const MemoryRouter = BrowserRouter;
const use = () => { const c = useContext(Ctx); if (!c) throw new Error('no router'); return c; };
export const useNavigate = () => { const { go } = use(); return (to: To | number, o?: Opts) => { if (typeof to === 'number') history.go(to); else go(to, o); }; };
export const useLocation = () => use().loc;
export function useSearchParams(): [URLSearchParams, (p: Record<string, string> | URLSearchParams) => void] {
  const { loc, go } = use();
  return [new URLSearchParams(loc.search), (p) => go({ pathname: loc.pathname, search: new URLSearchParams(p as Record<string, string>).toString() })];
}
export function Navigate({ to, replace, state }: { to: To; replace?: boolean; state?: unknown }) { const { go } = use(); useEffect(() => { go(to, { replace, state }); }, [JSON.stringify(to)]); return null; }
type LinkProps = { to: To; children: ReactNode; className?: string; onClick?: () => void; role?: string };
export function Link({ to, children, onClick, ...rest }: LinkProps) { const { go, loc } = use(); return <a href={href(to, loc)} {...rest} onClick={(e) => { e.preventDefault(); onClick?.(); go(to); }}>{children}</a>; }
export function NavLink({ to, children, className, end, onClick }: Omit<LinkProps, 'className'> & { end?: boolean; className?: string | ((s: { isActive: boolean }) => string) }) {
  const { go, loc } = use(); const target = href(to, loc).split('?')[0]!;
  const isActive = end ? loc.pathname === target : loc.pathname === target || loc.pathname.startsWith(target.endsWith('/') ? target : target + '/');
  return <a href={href(to, loc)} aria-current={isActive ? 'page' : undefined} className={typeof className === 'function' ? className({ isActive }) : className} onClick={(e) => { e.preventDefault(); onClick?.(); go(to); }}>{children}</a>;
}
export const Outlet = () => <>{useContext(OutletCtx)}</>;
type RouteProps = { path?: string; index?: boolean; element?: ReactElement; children?: ReactNode };
export function Route(_: RouteProps) { return null; }
export function Routes({ children }: { children: ReactNode }) {
  const { loc } = use();
  const want = loc.pathname.length > 1 ? loc.pathname.replace(/\/$/, '') : loc.pathname;
  const match = (nodes: ReactNode, base: string): ReactNode => {
    for (const n of ([] as ReactNode[]).concat(nodes)) {
      const el = n as ReactElement<RouteProps>; if (!el || !el.props) continue;
      if (el.props.index && want === base) return el.props.element ?? null;
      if (el.props.path && el.props.path !== '*') {
        const full = el.props.path.startsWith('/') ? el.props.path : (base.endsWith('/') ? base : base + '/') + el.props.path;
        const ps = fit(full, want); if (ps && !el.props.children) return <ParamsCtx.Provider value={ps}>{el.props.element}</ParamsCtx.Provider>;
        if (el.props.children && (want === full || want.startsWith(full + '/'))) { const inner = match(el.props.children, full); if (inner) return el.props.element ? <OutletCtx.Provider value={inner}>{el.props.element}</OutletCtx.Provider> : inner; }
      }
      if (!el.props.path && !el.props.index && el.props.children) { const inner = match(el.props.children, base); if (inner) return <OutletCtx.Provider value={inner}>{el.props.element}</OutletCtx.Provider>; }
    }
    return null;
  };
  const star = ([] as ReactNode[]).concat(children).find((n) => (n as ReactElement<RouteProps>)?.props?.path === '*') as ReactElement<RouteProps> | undefined;
  return <>{match(children, '/') ?? star?.props.element ?? null}</>;
}
