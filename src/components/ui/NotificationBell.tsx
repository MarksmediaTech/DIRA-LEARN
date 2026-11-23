// Global notification bell (22 Nov 2026) - replaces the Notifications page. Lives in the header on every signed-in page:
// live unread badge (Supabase Realtime, filtered to the signed-in user by Row Level Security), a short pop-up for each new
// notification, and a dropdown with the history (mark read, mark all read, open what it is about, load older ones).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Megaphone, MessageCircle, Users, AtSign, SmilePlus, BookOpen, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { relativeTime, safeInternalLink, nextToasts } from '@/features/chat/rules';

export const UNREAD_KEY = ['unread-notifications'] as const;
const LIST_KEY = ['notifications-bell'] as const;
const PAGE = 20;
export interface BellNotification { id: string; kind: string; title: string; body: string | null; link: string | null; read_at: string | null; created_at: string }

/** Older notifications (before links existed) open the page their kind belongs to. */
const FALLBACK: Record<string, string> = {
  announcement: '/chat?section=announcements', message: '/chat?section=direct', group_message: '/chat?section=groups', reply: '/chat?section=direct',
  reaction: '/chat?section=direct', group: '/chat?section=groups', assignment: '/assignments', certificate: '/certificates', course: '/courses', application: '/application',
};
export const destinationOf = (n: Pick<BellNotification, 'kind' | 'link'>): string | null => safeInternalLink(n.link) ?? FALLBACK[n.kind] ?? null;
const iconOf = (kind: string) => ({ announcement: Megaphone, message: MessageCircle, group_message: Users, group: Users, reply: AtSign, reaction: SmilePlus, course: BookOpen, assignment: BookOpen }[kind] ?? Bell);

export function NotificationBell({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [ring, setRing] = useState(0);
  const [toasts, setToasts] = useState<BellNotification[]>([]);
  const shown = useRef(new Set<string>());
  const wrap = useRef<HTMLDivElement>(null);

  const unread = useQuery({
    queryKey: UNREAD_KEY, refetchInterval: 60_000,
    queryFn: async () => { const { count, error } = await supabase.from('notifications').select('id', { count: 'exact', head: true }).is('read_at', null); if (error) throw error; return count ?? 0; },
  });
  const list = useInfiniteQuery({
    queryKey: LIST_KEY, enabled: open, initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await supabase.from('notifications').select('id, kind, title, body, link, read_at, created_at').order('created_at', { ascending: false }).range(pageParam, pageParam + PAGE - 1);
      if (error) throw error; return (data ?? []) as BellNotification[];
    },
    getNextPageParam: (last, pages) => (last.length < PAGE ? undefined : pages.length * PAGE),
  });
  const refresh = useCallback(() => { void qc.invalidateQueries({ queryKey: UNREAD_KEY }); void qc.invalidateQueries({ queryKey: LIST_KEY }); }, [qc]);

  // live: new notifications pop up once; read changes (also from another device) update the badge
  useEffect(() => {
    const ch = supabase.channel(`bell-${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (payload: { new: BellNotification }) => {
        const n = payload.new; if (!n?.id) return;
        setToasts((t) => nextToasts(t, n, shown.current)); setRing((r) => r + 1); refresh();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, refresh)
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [userId, refresh]);
  // pop-ups disappear by themselves after 6 seconds (they stay in the history)
  useEffect(() => {
    if (!toasts.length) return;
    const t = window.setTimeout(() => setToasts((all) => all.slice(1)), 6000);
    return () => window.clearTimeout(t);
  }, [toasts]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => { if (e instanceof KeyboardEvent ? e.key === 'Escape' : !wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);

  const markRead = async (ids: string[]) => {
    if (!ids.length) return;
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).in('id', ids).is('read_at', null);
    refresh();
  };
  const markAll = async () => { await supabase.from('notifications').update({ read_at: new Date().toISOString() }).is('read_at', null); refresh(); };
  const openOne = (n: BellNotification) => {
    if (!n.read_at) void markRead([n.id]);
    setOpen(false); setToasts((t) => t.filter((x) => x.id !== n.id));
    const to = destinationOf(n); if (to) navigate(to);
  };
  const count = unread.data ?? 0;
  const items = list.data?.pages.flat() ?? [];

  return (
    <div ref={wrap} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="dialog" aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
        className="relative rounded-full p-2 text-current hover:bg-white/10 focus-visible:outline-dira-orange md:text-ink md:hover:bg-purple-50 md:dark:text-gray-100 md:dark:hover:bg-gray-800">
        <Bell key={ring} size={22} aria-hidden className={ring ? 'origin-top animate-ring motion-reduce:animate-none' : ''} />
        {count > 0 && <span aria-hidden className="absolute -right-0.5 -top-0.5 min-w-[1.25rem] rounded-full bg-orange-500 px-1 text-center text-[11px] font-bold leading-5 text-ink ring-2 ring-white dark:ring-gray-900">{count > 99 ? '99+' : count}</span>}
      </button>

      {open && (
        <div role="dialog" aria-label="Notifications"
          className="fixed inset-x-2 top-16 z-50 flex max-h-[75vh] flex-col overflow-hidden rounded-2xl border border-purple-100 bg-white text-ink shadow-2xl dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96">
          <div className="flex items-center justify-between border-b border-purple-100 px-4 py-3 dark:border-gray-700">
            <h2 className="font-display text-base font-semibold">Notifications</h2>
            <span className="flex gap-1">
              {count > 0 && <button type="button" onClick={() => void markAll()} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium text-purple-700 hover:bg-purple-50 dark:text-purple-300 dark:hover:bg-gray-800"><CheckCheck size={14} aria-hidden /> Mark all as read</button>}
              <button type="button" onClick={() => setOpen(false)} aria-label="Close notifications" className="rounded-full p-1 hover:bg-purple-50 dark:hover:bg-gray-800"><X size={16} aria-hidden /></button>
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {list.isLoading && <p role="status" className="p-4 text-sm">Loading…</p>}
            {list.isError && <p role="alert" className="p-4 text-sm text-danger">Could not load notifications.</p>}
            {list.data && !items.length && <p className="p-6 text-center text-sm text-ink/60 dark:text-gray-400">You&apos;re all caught up. New announcements, messages and updates will appear here.</p>}
            <ul aria-label="Notification history">
              {items.map((n) => {
                const Icon = iconOf(n.kind);
                return (
                  <li key={n.id} className={`group flex gap-3 border-b border-purple-50 px-4 py-3 last:border-0 dark:border-gray-800 ${n.read_at ? '' : 'bg-purple-50/70 dark:bg-purple-950/30'}`}>
                    <span className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${n.read_at ? 'bg-gray-100 text-ink/50 dark:bg-gray-800' : 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200'}`}><Icon size={16} aria-hidden /></span>
                    <button type="button" onClick={() => openOne(n)} className="min-w-0 flex-1 text-left">
                      <span className={`block text-sm ${n.read_at ? '' : 'font-semibold'}`}>{n.title}{!n.read_at && <span className="sr-only"> (unread)</span>}</span>
                      {n.body && <span className="line-clamp-2 block text-xs text-ink/70 dark:text-gray-300">{n.body}</span>}
                      <time dateTime={n.created_at} className="text-[11px] text-ink/50 dark:text-gray-400">{relativeTime(n.created_at)}</time>
                    </button>
                    {!n.read_at && <button type="button" onClick={() => void markRead([n.id])} aria-label={`Mark "${n.title}" as read`} className="self-start rounded-full p-1 text-purple-700 hover:bg-purple-100 dark:text-purple-300 dark:hover:bg-gray-800"><span aria-hidden className="block h-2.5 w-2.5 rounded-full bg-purple-600" /></button>}
                  </li>
                );
              })}
            </ul>
            {list.hasNextPage && <div className="p-3 text-center"><button type="button" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()} className="rounded-full border border-purple-200 px-3 py-1 text-xs dark:border-gray-600">{list.isFetchingNextPage ? 'Loading…' : 'Show older notifications'}</button></div>}
          </div>
        </div>
      )}

      {/* pop-ups: polite live region, top-right, never cover the whole screen; reduced motion respected */}
      <div aria-live="polite" className="pointer-events-none fixed right-3 top-16 z-[60] grid w-[min(22rem,calc(100vw-1.5rem))] gap-2">
        {toasts.map((n) => {
          const Icon = iconOf(n.kind);
          return (
            <div key={n.id} role="status" className="pointer-events-auto flex animate-toast-in items-start gap-3 rounded-2xl border border-purple-100 bg-white p-3 text-ink shadow-xl motion-reduce:animate-none dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200"><Icon size={16} aria-hidden /></span>
              <button type="button" onClick={() => openOne(n)} className="min-w-0 flex-1 text-left">
                <span className="block text-sm font-semibold">{n.title}</span>
                {n.body && <span className="line-clamp-2 block text-xs text-ink/70 dark:text-gray-300">{n.body}</span>}
              </button>
              <button type="button" onClick={() => setToasts((t) => t.filter((x) => x.id !== n.id))} aria-label="Dismiss" className="rounded-full p-1 hover:bg-purple-50 dark:hover:bg-gray-800"><X size={14} aria-hidden /></button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
