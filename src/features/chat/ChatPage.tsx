// Chat (22 Nov 2026): one place for announcements, direct messages, group conversations, shared materials and audio/video.
// Replaces the separate Announcements, Notifications and DIRA Connect pages (notifications now live in the bell in the header).
// Address: /chat?section=…  ·  /chat?c=<conversation>[&m=<message>]  ·  /chat?a=<announcement>
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FileText, Film, Megaphone, MessageCircle, Plus, Search, ShieldAlert, Users, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import * as api from './api';
import { Announcements } from './Announcements';
import { ThreadView } from './ThreadView';
import { PeoplePicker } from './PeoplePicker';
import { AttachmentView, Avatar } from './parts';
import { usePresence } from './usePresence';
import { SECTIONS, categoryOf, formatBytes, isSection, sectionOfKind, shortTime, type ChatSection } from './rules';

const ICONS: Record<ChatSection, typeof Megaphone> = { announcements: Megaphone, direct: MessageCircle, groups: Users, materials: FileText, media: Film };
const STAFF = ['super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator', 'trainer', 'mentor', 'me_officer'];

export function ChatPage() {
  const { profile } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const online = usePresence(profile?.id);
  const conv = params.get('c'); const ann = params.get('a'); const msg = params.get('m');
  const inbox = useQuery({ queryKey: ['chat-inbox'], queryFn: api.inbox, refetchInterval: 30_000 });
  const current = (inbox.data ?? []).find((i) => i.conversation_id === conv) ?? null;
  const section: ChatSection = conv ? (current ? sectionOfKind(current.kind) : 'direct') : ann ? 'announcements' : isSection(params.get('section')) ? (params.get('section') as ChatSection) : 'announcements';
  const go = (next: Record<string, string>) => navigate({ pathname: '/chat', search: new URLSearchParams(next).toString() });

  // any new message in a conversation the user can see refreshes the list (unread counts) without reloading
  useEffect(() => {
    const ch = supabase.channel('chat-inbox')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'connect_messages' }, () => void qc.invalidateQueries({ queryKey: ['chat-inbox'] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'connect_members' }, () => void qc.invalidateQueries({ queryKey: ['chat-inbox'] }))
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [qc]);

  const unreadBy = (s: ChatSection) => (inbox.data ?? []).filter((i) => sectionOfKind(i.kind) === s).reduce((n, i) => n + Number(i.unread ?? 0), 0);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-purple-700 dark:text-purple-300">Chat</h1>
          <p className="text-sm text-ink/70 dark:text-gray-400">Announcements, conversations and learning materials in one place. Be kind and respectful; use Report if a message worries you.</p>
        </div>
      </div>
      <nav aria-label="Chat sections" className="-mx-1 flex gap-1 overflow-x-auto pb-1">
        {SECTIONS.map((s) => {
          const Icon = ICONS[s.id]; const n = s.id === 'direct' || s.id === 'groups' ? unreadBy(s.id) : 0;
          return (
            <button key={s.id} type="button" onClick={() => go({ section: s.id })} aria-current={section === s.id ? 'page' : undefined}
              className={`inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition ${section === s.id ? 'bg-purple-700 text-white shadow' : 'bg-white text-ink hover:bg-purple-50 dark:bg-gray-900 dark:text-gray-200 dark:hover:bg-gray-800'}`}>
              <Icon size={16} aria-hidden /> {s.label}
              {n > 0 && <span className="rounded-full bg-orange-500 px-1.5 text-xs font-bold text-ink">{n}<span className="sr-only"> unread</span></span>}
            </button>
          );
        })}
      </nav>

      {section === 'announcements' && <Announcements focus={ann} />}
      {(section === 'direct' || section === 'groups') && (
        <div className="grid gap-4 md:grid-cols-[20rem_1fr]">
          <div className={`${current ? 'hidden md:grid' : 'grid'} content-start gap-3`}>
            <ConversationList section={section} items={inbox.data ?? []} loading={inbox.isLoading} failed={inbox.isError} selected={conv} online={online}
              onOpen={(id) => go({ c: id })} canGroup={STAFF.includes(profile?.role ?? '')} isLearner={profile?.role === 'participant'} />
          </div>
          <div className={current ? 'block' : 'hidden md:block'}>
            {current ? <ThreadView key={current.conversation_id} item={current} online={online} focusMessage={msg} onBack={() => go({ section })} />
              : conv && inbox.data ? <p role="alert" className="dira-panel rounded-2xl border border-purple-100 p-6 text-sm">This conversation is not available to you.</p>
              : <div className="dira-panel hidden h-full min-h-[20rem] place-items-center rounded-2xl border border-dashed border-purple-200 text-sm text-ink/60 md:grid dark:border-gray-700 dark:text-gray-400">Choose a conversation, or start a new one.</div>}
          </div>
        </div>
      )}
      {(section === 'materials' || section === 'media') && <Library kind={section} />}
    </div>
  );
}

function ConversationList({ section, items, loading, failed, selected, online, onOpen, canGroup, isLearner }: {
  section: 'direct' | 'groups'; items: api.InboxItem[]; loading: boolean; failed: boolean; selected: string | null; online: Set<string>;
  onOpen: (id: string) => void; canGroup: boolean; isLearner: boolean;
}) {
  const [q, setQ] = useState(''); const [starting, setStarting] = useState(false); const [deep, setDeep] = useState('');
  const list = useMemo(() => items.filter((i) => sectionOfKind(i.kind) === section)
    .filter((i) => !q.trim() || `${i.title ?? ''} ${i.last_message ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())), [items, section, q]);
  const found = useQuery({ queryKey: ['chat-search', deep], enabled: deep.trim().length >= 2, queryFn: () => api.search(deep.trim()) });
  return (
    <div className="dira-panel grid content-start gap-3 rounded-2xl border border-purple-100 p-3">
      <div className="flex items-center gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Search conversations</span>
          <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
          <input value={q} onChange={(e) => { setQ(e.target.value); setDeep(e.target.value); }} placeholder="Search conversations and messages"
            className="w-full rounded-full border border-purple-200 bg-white py-2 pl-9 pr-3 text-sm dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100" />
        </label>
        {(section === 'direct' || canGroup) && (
          <button type="button" onClick={() => setStarting((v) => !v)} aria-expanded={starting} aria-label={section === 'direct' ? 'New conversation' : 'New group'}
            className="rounded-full bg-purple-700 p-2 text-white shadow hover:bg-purple-800">{starting ? <X size={18} aria-hidden /> : <Plus size={18} aria-hidden />}</button>
        )}
      </div>
      {starting && (section === 'direct' ? <NewDirect onOpen={(id) => { setStarting(false); onOpen(id); }} isLearner={isLearner} /> : <NewGroup onOpen={(id) => { setStarting(false); onOpen(id); }} />)}
      {loading && <p role="status" className="text-sm">Loading conversations…</p>}
      {failed && <p role="alert" className="text-sm text-danger">Could not load conversations.</p>}
      {!loading && !list.length && !q && (
        <div className="rounded-2xl border border-dashed border-purple-200 p-6 text-center text-sm text-ink/60 dark:border-gray-700 dark:text-gray-400">
          {section === 'direct' ? 'No conversations yet. Press + to message someone.' : canGroup ? 'No groups yet. Press + to create one.' : 'You are not in a group or cohort discussion yet.'}
        </div>
      )}
      <ul className="grid gap-1" aria-label="Conversations">
        {list.map((i) => {
          const unread = Number(i.unread ?? 0); const isGroup = i.kind === 'group' || i.kind === 'cohort';
          return (
            <li key={i.conversation_id}>
              <button type="button" onClick={() => onOpen(i.conversation_id)} aria-current={i.conversation_id === selected ? 'true' : undefined}
                className={`flex w-full items-center gap-3 rounded-2xl p-2.5 text-left transition ${i.conversation_id === selected ? 'bg-purple-100 dark:bg-gray-800' : 'hover:bg-white/10 dark:hover:bg-gray-900'}`}>
                {isGroup ? <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-700 dark:bg-gray-800 dark:text-purple-300">{i.kind === 'safeguarding' ? <ShieldAlert size={18} aria-hidden /> : <Users size={18} aria-hidden />}</span>
                  : <Avatar id={i.other_profile_id} name={i.title} online={i.other_profile_id ? online.has(i.other_profile_id) : undefined} />}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className={`truncate text-sm ${unread ? 'font-bold' : 'font-medium'}`}>{i.title ?? 'Conversation'}</span>
                    <span className="shrink-0 text-[11px] text-ink/50 dark:text-gray-400">{shortTime(i.last_message_at)}</span>
                  </span>
                  <span className="flex items-center justify-between gap-2">
                    <span className={`truncate text-xs ${unread ? 'text-ink dark:text-gray-200' : 'text-ink/60 dark:text-gray-400'}`}>{i.last_message ?? i.subtitle}</span>
                    {unread > 0 && <span className="shrink-0 rounded-full bg-orange-500 px-1.5 text-[11px] font-bold text-[#21173A]">{unread}<span className="sr-only"> unread</span></span>}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {deep.trim().length >= 2 && (found.data ?? []).length > 0 && (
        <div className="grid gap-1">
          <p className="px-1 text-xs font-semibold uppercase tracking-wide text-ink/60">Messages</p>
          <ul className="grid gap-1">
            {(found.data ?? []).map((r) => (
              <li key={r.message_id}><button type="button" onClick={() => onOpen(r.conversation_id)} className="w-full rounded-xl p-2 text-left text-xs hover:bg-white/10 dark:hover:bg-gray-900">
                <span className="font-semibold">{r.sender_name}</span> · {shortTime(r.created_at)}<span className="block truncate text-ink/70 dark:text-gray-300">{r.body}</span></button></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function NewDirect({ onOpen, isLearner }: { onOpen: (id: string) => void; isLearner: boolean }) {
  const qc = useQueryClient(); const [error, setError] = useState<string | null>(null);
  const start = useMutation({ mutationFn: (c: api.Contact) => api.startDm(c.profile_id), onSuccess: (id) => { void qc.invalidateQueries({ queryKey: ['chat-inbox'] }); onOpen(id); }, onError: (e: Error) => setError(e.message) });
  const sg = useMutation({ mutationFn: api.startSafeguarding, onSuccess: (id) => { void qc.invalidateQueries({ queryKey: ['chat-inbox'] }); onOpen(id); }, onError: (e: Error) => setError(e.message) });
  return (
    <div className="grid gap-3 rounded-2xl border border-purple-100 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
      <p className="text-sm font-semibold">New conversation</p>
      <PeoplePicker picked={[]} onPickOne={(c) => start.mutate(c)} />
      {isLearner && (
        <div className="rounded-xl bg-orange-50 p-3 text-xs dark:bg-orange-950">
          <p className="font-semibold">Need to talk about your safety or someone else&apos;s?</p>
          <button type="button" disabled={sg.isPending} onClick={() => sg.mutate()} className="mt-2 rounded-full bg-orange-500 px-3 py-1 font-semibold text-[#21173A]">Message the safeguarding team</button>
          <p className="mt-1 text-ink/70 dark:text-gray-300">Only DIRA&apos;s safeguarding officers can read it. If you are in danger now, contact the emergency services.</p>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function NewGroup({ onOpen }: { onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(''); const [picked, setPicked] = useState<api.Contact[]>([]); const [error, setError] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => { if (!title.trim()) throw new Error('Give the group a name.'); if (!picked.length) throw new Error('Add at least one member.'); return api.createGroup(title.trim(), picked.map((p) => p.profile_id)); },
    onSuccess: (id) => { void qc.invalidateQueries({ queryKey: ['chat-inbox'] }); onOpen(id); }, onError: (e: Error) => setError(e.message),
  });
  return (
    <div className="grid gap-3 rounded-2xl border border-purple-100 bg-white p-3 dark:border-gray-700 dark:bg-gray-900">
      <p className="text-sm font-semibold">New group</p>
      <label className="grid gap-1 text-xs font-medium">Group name<input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} className="rounded-full border border-purple-200 px-4 py-1.5 text-sm font-normal dark:border-gray-600 dark:bg-gray-800" /></label>
      <PeoplePicker picked={picked} onChange={setPicked} multiple />
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <button type="button" disabled={create.isPending} onClick={() => create.mutate()} className="justify-self-start rounded-full bg-purple-700 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50">Create group{picked.length ? ` (${picked.length + 1})` : ''}</button>
      <p className="text-[11px] text-ink/60 dark:text-gray-400">You can add the people you may message (for trainers: learners of your cohorts and other staff). Cohort discussions exist automatically.</p>
    </div>
  );
}

function Library({ kind }: { kind: 'materials' | 'media' }) {
  const items = useQuery({ queryKey: ['chat-library'], queryFn: api.library, refetchInterval: 60_000 });
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const wanted = (items.data ?? []).filter((f) => {
    const c = categoryOf(f.mime);
    return (kind === 'media' ? c === 'audio' || c === 'video' : c === 'document' || c === 'image') && (!q.trim() || f.name.toLowerCase().includes(q.trim().toLowerCase()));
  });
  return (
    <div className="grid gap-3">
      <label className="relative max-w-md">
        <span className="sr-only">Search files</span>
        <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={kind === 'media' ? 'Search audio and video' : 'Search documents and images'} className="w-full rounded-full border border-purple-200 bg-white py-2 pl-9 pr-3 text-sm dark:border-gray-600 dark:bg-gray-900" />
      </label>
      {items.isLoading && <p role="status" className="text-sm">Loading files…</p>}
      {items.isError && <p role="alert" className="text-sm text-danger">Could not load files.</p>}
      {items.data && !wanted.length && (
        <div className="dira-panel rounded-2xl border border-dashed border-purple-200 p-8 text-center text-sm text-ink/60 dark:border-gray-700 dark:text-gray-400">
          {kind === 'media' ? 'No audio or video yet. Voice messages, audio lessons and videos shared with you appear here.' : 'No materials yet. Documents, slides and images shared with you appear here.'}
        </div>
      )}
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {wanted.map((f) => (
          <li key={f.key} className="dira-panel grid content-start gap-2 rounded-2xl border border-purple-100 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-900">
            <AttachmentView file={{ id: f.key, path: f.path, name: f.name, mime: f.mime, size: f.size, scan: f.scan ?? undefined }} bucket={f.bucket} />
            <p className="text-xs text-ink/60 dark:text-gray-400">{formatBytes(f.size)} · {new Date(f.created_at).toLocaleDateString('en-GB')} · <button type="button" className="underline" onClick={() => navigate(f.link)}>{f.where}</button></p>
          </li>
        ))}
      </ul>
    </div>
  );
}
