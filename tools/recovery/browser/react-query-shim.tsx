// Minimal stand-in for @tanstack/react-query (not installable here), enough for the screens in the browser harness:
// useQuery (enabled, refetch on invalidate), useInfiniteQuery (pages, fetchNextPage, hasNextPage), useMutation
// (mutate with variables, isPending, onSuccess/onError) and useQueryClient().invalidateQueries (key-prefix match, as the library).
// Timed refetching (refetchInterval) is not simulated; tests trigger refreshes through Realtime events or invalidation.
import { useCallback, useEffect, useRef, useState } from 'react';
type Key = readonly unknown[];
const listeners = new Set<(k: string) => void>();
const keyStr = (k: Key) => JSON.stringify(k);
const matches = (k: string, prefix: string) => k === prefix || k.startsWith(prefix.slice(0, -1) + ',');
type QState<T> = { data?: T; error?: unknown; isLoading: boolean; isError: boolean; isFetching: boolean };
export function useQuery<T>({ queryKey, queryFn, enabled = true }: { queryKey: Key; queryFn: () => Promise<T>; enabled?: boolean; [k: string]: unknown }) {
  const [state, set] = useState<QState<T>>({ isLoading: enabled, isError: false, isFetching: enabled });
  const k = keyStr(queryKey); const fn = useRef(queryFn); fn.current = queryFn;
  const run = useCallback(() => { set((s) => ({ ...s, isLoading: s.data === undefined, isFetching: true }));
    fn.current().then((data) => set({ data, isLoading: false, isError: false, isFetching: false }), (error: unknown) => set({ error, isLoading: false, isError: true, isFetching: false })); }, [k]);
  useEffect(() => { if (!enabled) { set((s) => ({ ...s, isLoading: false, isFetching: false })); return; } run(); const l = (p: string) => { if (matches(k, p)) run(); }; listeners.add(l); return () => { listeners.delete(l); }; }, [run, k, enabled]);
  return { ...state, refetch: run };
}
export function useInfiniteQuery<T, P = number>({ queryKey, queryFn, enabled = true, initialPageParam, getNextPageParam }: {
  queryKey: Key; queryFn: (c: { pageParam: P }) => Promise<T>; enabled?: boolean; initialPageParam: P; getNextPageParam: (last: T, pages: T[]) => P | undefined; [k: string]: unknown }) {
  const [state, set] = useState<{ data?: { pages: T[] }; isLoading: boolean; isError: boolean; isFetchingNextPage: boolean }>({ isLoading: enabled, isError: false, isFetchingNextPage: false });
  const k = keyStr(queryKey); const fn = useRef(queryFn); fn.current = queryFn; const pagesRef = useRef<T[]>([]);
  const reload = useCallback(async () => {   // like the library: a refetch reloads every page already loaded
    const n = Math.max(pagesRef.current.length, 1); const pages: T[] = []; let p: P | undefined = initialPageParam;
    try { for (let i = 0; i < n && p !== undefined; i++) { const page: T = await fn.current({ pageParam: p }); pages.push(page); p = getNextPageParam(page, pages); }
      pagesRef.current = pages; set({ data: { pages }, isLoading: false, isError: false, isFetchingNextPage: false }); } catch { set((s) => ({ ...s, isLoading: false, isError: true })); }
  }, [k]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!enabled) { set((s) => ({ ...s, isLoading: false })); return; } void reload(); const l = (p: string) => { if (matches(k, p)) void reload(); }; listeners.add(l); return () => { listeners.delete(l); }; }, [reload, k, enabled]);
  const pages = state.data?.pages ?? [];
  const next = pages.length ? getNextPageParam(pages[pages.length - 1]!, pages) : undefined;
  const fetchNextPage = async () => { if (next === undefined) return; set((s) => ({ ...s, isFetchingNextPage: true })); const page = await fn.current({ pageParam: next }); pagesRef.current = [...pagesRef.current, page]; set({ data: { pages: pagesRef.current }, isLoading: false, isError: false, isFetchingNextPage: false }); };
  return { ...state, hasNextPage: next !== undefined, fetchNextPage };
}
export function useMutation<T, V = void>({ mutationFn, onSuccess, onError }: { mutationFn: (v: V) => Promise<T>; onSuccess?: (d: T) => void; onError?: (e: Error) => void }) {
  const [s, set] = useState<{ isPending: boolean; isError: boolean; error: unknown }>({ isPending: false, isError: false, error: null });
  const mutate = (v: V) => { set({ isPending: true, isError: false, error: null });   // the variables are passed on, as in the library
    let p: Promise<T>; try { p = Promise.resolve(mutationFn(v)); } catch (e) { p = Promise.reject(e); }
    p.then((d) => { set({ isPending: false, isError: false, error: null }); onSuccess?.(d); }, (e: Error) => { set({ isPending: false, isError: true, error: e }); onError?.(e); }); };
  return { ...s, mutate };
}
// one client for the whole page, as with <QueryClientProvider>: hooks that list the client as an effect dependency rely on it being stable
const client = { invalidateQueries: async ({ queryKey }: { queryKey: Key }) => { listeners.forEach((l) => l(keyStr(queryKey))); } };
export const useQueryClient = () => client;
export function QueryClientProvider({ children }: { children: unknown }) { return children as JSX.Element; }
export class QueryClient { constructor(_?: unknown) {} }
