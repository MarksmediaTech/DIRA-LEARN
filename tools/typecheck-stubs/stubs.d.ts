// Hand-written type definitions used ONLY to type-check DIRA LEARN when `npm install` is not possible.
// They model the parts of each library the project uses. The real check is still `npm run typecheck` with the real packages.
/* eslint-disable */

declare module 'react' {
  export type ReactNode = any;
  export type Key = string | number;
  export interface FormEvent<T = Element> { preventDefault(): void; stopPropagation(): void; currentTarget: T; target: any }
  export interface ChangeEvent<T = Element> { target: T; currentTarget: T }
  export interface KeyboardEvent<T = Element> { key: string; shiftKey: boolean; preventDefault(): void; target: any; currentTarget: T; [k: string]: any }
  export interface ButtonHTMLAttributes<T> { [k: string]: any; className?: string; children?: ReactNode; _el?: T }
  export function useState<S>(initial: S | (() => S)): [S, (v: S | ((prev: S) => S)) => void];
  export function useState<S = undefined>(): [S | undefined, (v: S | undefined | ((prev: S | undefined) => S | undefined)) => void];
  export function useEffect(fn: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(fn: () => T, deps: readonly unknown[]): T;
  export function useCallback<T extends (...a: any[]) => any>(fn: T, deps: readonly unknown[]): T;
  export function useRef<T>(v: T): { current: T };
  export function useRef<T>(v: T | null): { current: T | null };
  export interface Context<T> { Provider: any; Consumer: any; _t?: T }
  export function createContext<T>(v: T): Context<T>;
  export function useContext<T>(c: Context<T>): T;
  export const StrictMode: any;
  export const Fragment: any;
}

declare module 'react/jsx-runtime' {
  export const jsx: any; export const jsxs: any; export const Fragment: any;
  export namespace JSX {
    interface Element {}
    interface DomEvent { target: HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement; currentTarget: HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement; preventDefault(): void; stopPropagation(): void; key: string; [k: string]: any }
    interface Attrs { [k: string]: any;
      onChange?: (e: DomEvent) => void; onInput?: (e: DomEvent) => void; onClick?: (e: DomEvent) => void; onSubmit?: (e: DomEvent) => void;
      onBlur?: (e: DomEvent) => void; onFocus?: (e: DomEvent) => void; onKeyDown?: (e: DomEvent) => void; onKeyUp?: (e: DomEvent) => void;
      onMouseEnter?: (e: DomEvent) => void; onMouseLeave?: (e: DomEvent) => void; onDragOver?: (e: DomEvent) => void; onDrop?: (e: DomEvent) => void; onLoad?: (e: DomEvent) => void; onError?: (e: DomEvent) => void;
      ref?: any }
    interface IntrinsicElements { [k: string]: Attrs }
    interface IntrinsicAttributes { key?: any }
    interface ElementChildrenAttribute { children: {} }
  }
}

declare module 'react-dom/client' { export function createRoot(el: Element | null): { render(n: any): void } }

declare module '@tanstack/react-query' {
  export interface UseQueryResult<T> { data: T | undefined; isLoading: boolean; isPending: boolean; isError: boolean; isSuccess: boolean; isFetching: boolean; error: Error | null; refetch(): Promise<unknown> }
  export function useQuery<T>(o: { queryKey: readonly unknown[]; queryFn: () => Promise<T> | T; enabled?: boolean; refetchInterval?: number | false; staleTime?: number; retry?: unknown; placeholderData?: unknown }): UseQueryResult<T>;
  export interface UseMutationResult<TData, TVars> { mutate(v: TVars, opts?: unknown): void; mutateAsync(v: TVars): Promise<TData>; isPending: boolean; isError: boolean; isSuccess: boolean; error: Error | null; data: TData | undefined; variables: TVars | undefined; reset(): void }
  export interface UseInfiniteQueryResult<T> { data: { pages: T[] } | undefined; isLoading: boolean; isError: boolean; hasNextPage: boolean; isFetchingNextPage: boolean; fetchNextPage(): Promise<unknown> }
  export function useInfiniteQuery<T>(o: { queryKey: readonly unknown[]; queryFn: (c: { pageParam: number }) => Promise<T>; enabled?: boolean; initialPageParam: number; getNextPageParam: (last: T, pages: T[]) => number | undefined }): UseInfiniteQueryResult<T>;
  export function useMutation<TData = unknown, TVars = void>(o: {
    mutationFn: (v: TVars) => Promise<TData>;
    onSuccess?: (d: TData, v: TVars) => unknown; onError?: (e: Error, v: TVars) => unknown; onSettled?: (...a: any[]) => unknown; onMutate?: (v: TVars) => unknown;
  }): UseMutationResult<TData, TVars>;
  export interface QueryClientLike { invalidateQueries(f?: { queryKey?: readonly unknown[] }): Promise<void>; setQueryData(k: readonly unknown[], v: unknown): void; getQueryData<T = unknown>(k: readonly unknown[]): T | undefined; removeQueries(f?: unknown): void; clear(): void }
  export function useQueryClient(): QueryClientLike;
  export class QueryClient implements QueryClientLike { constructor(o?: unknown); invalidateQueries(f?: { queryKey?: readonly unknown[] }): Promise<void>; setQueryData(k: readonly unknown[], v: unknown): void; getQueryData<T = unknown>(k: readonly unknown[]): T | undefined; removeQueries(f?: unknown): void; clear(): void }
  export const QueryClientProvider: any;
}

declare module '@supabase/supabase-js' {
  export function createClient(url: string, key: string, options?: unknown): any;
  export type Session = { user: { id: string; email?: string }; access_token: string; [k: string]: any };
  export type User = { id: string; email?: string; [k: string]: any };
}

declare module 'react-router-dom' {
  export const BrowserRouter: any; export const MemoryRouter: any; export const Routes: any; export const Route: any; export const Outlet: any;
  export const Link: any; export const Navigate: any;
  export function NavLink(p: { to: string; end?: boolean; className?: string | ((s: { isActive: boolean }) => string); children?: any; [k: string]: any }): any;
  export function useNavigate(): (to: string | number | { pathname?: string; search?: string }, o?: unknown) => void;
  export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T;
  export function useSearchParams(): [URLSearchParams, (v: URLSearchParams | Record<string, string> | ((p: URLSearchParams) => URLSearchParams), o?: unknown) => void];
  export function useLocation(): { pathname: string; search: string; hash: string; state: unknown };
}

declare module 'react-hook-form' { export function useForm<T = any>(o?: unknown): any; }
declare module '@hookform/resolvers/zod' { export const zodResolver: (schema: unknown) => any; }
declare module 'lucide-react' { export type LucideIcon = any; export const HeartHandshake: any; export const LogOut: any; export const Mic: any; export const Pause: any; export const Play: any; export const Rocket: any; export const Users: any; export const Menu: any; export const X: any; export const Megaphone: any; export const MessageCircle: any; export const Plus: any; export const Search: any; export const ShieldAlert: any; export const FileText: any; export const Film: any; export const ArrowLeft: any; export const Check: any; export const CheckCheck: any; export const CornerUpLeft: any; export const Flag: any; export const Paperclip: any; export const Send: any; export const UserPlus: any; export const Download: any; export const SmilePlus: any; export const Square: any; export const Trash2: any; export const Pin: any; export const PinOff: any; export const Pencil: any; export const Bell: any; export const AtSign: any; export const BookOpen: any; export const ChevronDown: any; export const KeyRound: any; }
declare module 'recharts' {
  export const ResponsiveContainer: any; export const BarChart: any; export const Bar: any; export const LineChart: any; export const Line: any;
  export const XAxis: any; export const YAxis: any; export const Tooltip: any; export const Legend: any; export const CartesianGrid: any;
}
declare module '@testing-library/react' { export const render: any; export const screen: any; export const fireEvent: any; export const waitFor: any; export const within: any; }
declare module '@testing-library/user-event' { const u: any; export default u; }
declare module '@testing-library/jest-dom' {}
declare module '@testing-library/jest-dom/vitest' {}
declare module 'vitest' { export const vi: any; export const describe: any; export const it: any; export const expect: any; export const beforeEach: any; export const afterEach: any; }
declare module '*.css' {}
declare module '*.png' { const src: string; export default src; }
declare module '*.svg' { const src: string; export default src; }

interface ImportMetaEnv { readonly [k: string]: string | undefined }
interface ImportMeta { readonly env: ImportMetaEnv }
declare const describe: ((name: string, fn: () => void) => void) & { each: any };
declare const it: ((name: string, fn: () => unknown) => void) & { each: any };
declare const vi: any;
declare const test: (name: string, fn: () => unknown) => void;
declare const expect: any;
declare const beforeEach: (fn: () => unknown) => void;
declare const afterEach: (fn: () => unknown) => void;

declare namespace React { type ReactNode = any; type ReactElement = any; type FormEvent<T = Element> = import('react').FormEvent<T> }

// Node pieces used by the schema test src/features/chat/announcementFiles.test.ts (the real project gets these from @types/node).
declare module 'node:fs' { export function existsSync(p: string): boolean; export function readdirSync(p: string): string[]; export function readFileSync(p: string, enc: string): string; }
declare module 'node:path' { export function join(...parts: string[]): string; }
declare const process: { cwd(): string };
