// One conversation (22 Nov 2026): messages with replies, reactions, files, voice messages, search, read ticks and live updates.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, CheckCheck, CornerUpLeft, Flag, Paperclip, Search, Send, UserPlus, LogOut, Users, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { useProgrammeTimezone } from '@/features/cohorts/useProgrammeTimezone';
import { REPORT_REASONS, groupByDay, linkify, validateMessage, validateReport } from '@/features/connect/rules';
import * as api from './api';
import { AttachmentView, AudioRecorder, Avatar, EmojiPicker, PendingFiles, ReactionBar } from './parts';
import { FILE_ACCEPT, QUICK_REACTIONS, SUPPORTED_SUMMARY, deliveryState, fileProblem, matchesQuery } from './rules';
import { PeoplePicker } from './PeoplePicker';

const dayLabel = (day: string): string => {
  const d = new Date(`${day}T12:00:00`); const today = new Date(); const y = new Date(Date.now() - 86_400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  return same(d, today) ? 'Today' : same(d, y) ? 'Yesterday' : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
};

export function ThreadView({ item, online, focusMessage, onBack }: { item: api.InboxItem; online: Set<string>; focusMessage: string | null; onBack: () => void }) {
  const { profile } = useAuth();
  const { tz } = useProgrammeTimezone();
  const qc = useQueryClient();
  const id = item.conversation_id;
  const [older, setOlder] = useState<api.ChatMessage[]>([]);
  const [text, setText] = useState(''); const [files, setFiles] = useState<File[]>([]);
  const [replyTo, setReplyTo] = useState<api.ChatMessage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false); const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const bottom = useRef<HTMLDivElement>(null); const fileInput = useRef<HTMLInputElement>(null);

  const recent = useQuery({ queryKey: ['chat-messages', id], refetchInterval: 30_000, queryFn: () => api.messages(id) });
  const reads = useQuery({ queryKey: ['chat-reads', id], enabled: item.kind !== 'cohort', refetchInterval: 30_000, queryFn: () => api.readState(id) });
  const all = useMemo(() => {
    const seen = new Set<string>(); const out: api.ChatMessage[] = [];
    for (const m of [...(recent.data ?? []), ...older]) if (!seen.has(m.id)) { seen.add(m.id); out.push(m); }
    return out;
  }, [recent.data, older]);
  const shown = useMemo(() => all.filter((m) => matchesQuery(m.body, q)), [all, q]);
  const days = groupByDay(shown, tz);

  // live updates (Realtime follows the same read rules as the database; the 30 s refresh covers a dropped connection)
  useEffect(() => {
    const refresh = () => { void qc.invalidateQueries({ queryKey: ['chat-messages', id] }); void qc.invalidateQueries({ queryKey: ['chat-inbox'] }); };
    const channel = supabase.channel(`chat-${id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'connect_messages', filter: `conversation_id=eq.${id}` }, refresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'connect_attachments', filter: `conversation_id=eq.${id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'connect_reactions' }, refresh)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [id, qc]);
  const newest = recent.data?.[0]?.id ?? null;
  useEffect(() => {
    if (!newest) return;
    void api.markRead(id).then(() => { void qc.invalidateQueries({ queryKey: ['chat-inbox'] }); });
    if (!focusMessage) bottom.current?.scrollIntoView?.({ block: 'end' });
  }, [id, newest, qc, focusMessage]);
  useEffect(() => {
    if (!focusMessage || !recent.data) return;
    document.getElementById(`msg-${focusMessage}`)?.scrollIntoView?.({ block: 'center' });
  }, [focusMessage, recent.data]);

  const loadOlder = useMutation({
    mutationFn: async () => api.messages(id, all[all.length - 1]?.created_at),
    onSuccess: (rows) => setOlder((o) => [...o, ...rows]),
  });
  const send = useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error('You are not signed in.');
      const audio = files.length && files.every((f) => f.type.startsWith('audio/'));
      const body = text.trim() || (files.length ? (audio ? 'Voice message' : files.length === 1 ? `Shared ${files[0]!.name}` : `Shared ${files.length} files`) : '');
      const bad = validateMessage(body) ?? fileProblem(files);
      if (bad) throw new Error(bad);
      await api.sendMessage(id, profile.id, body, replyTo?.id ?? null, files);
    },
    onSuccess: () => { setText(''); setFiles([]); setReplyTo(null); setError(null); void qc.invalidateQueries({ queryKey: ['chat-messages', id] }); void qc.invalidateQueries({ queryKey: ['chat-inbox'] }); },
    onError: (e: Error) => setError(e.message),
  });
  const react = useMutation({
    mutationFn: ({ m, emoji }: { m: string; emoji: string }) => api.react(m, emoji),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['chat-messages', id] }),
    onError: (e: Error) => setError(e.message),
  });
  const leave = useMutation({
    mutationFn: () => api.leaveGroup(id, profile!.id),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['chat-inbox'] }); onBack(); },
    onError: (e: Error) => setError(e.message),
  });

  const onKey = (e: { key: string; shiftKey?: boolean; preventDefault(): void }) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!send.isPending) send.mutate(); } };
  const addFiles = (list: FileList | File[] | null) => {
    const next = [...files, ...Array.from(list ?? [])]; const bad = fileProblem(next);
    if (bad) { setError(bad); return; }
    setError(null); setFiles(next);
  };
  const others = item.kind === 'dm' || item.kind === 'direct' ? 1 : Math.max((item.member_count ?? 1) - 1, 0);
  const canReact = item.kind !== 'safeguarding' && item.can_post;
  const isGroupish = item.kind === 'group' || item.kind === 'cohort';

  return (
    <section aria-label={`Conversation: ${item.title ?? ''}`} className="dira-panel flex h-[calc(100vh-12rem)] min-h-[28rem] flex-col overflow-hidden rounded-2xl border border-purple-100 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900 md:h-[calc(100vh-10rem)]">
      <header className="flex items-center gap-3 border-b border-purple-100 px-3 py-2 dark:border-gray-700">
        <button type="button" onClick={onBack} aria-label="Back to conversations" className="rounded-full p-2 hover:bg-purple-50 md:hidden dark:hover:bg-gray-800"><ArrowLeft size={18} aria-hidden /></button>
        {isGroupish ? <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-purple-100 text-purple-700 dark:bg-gray-800"><Users size={18} aria-hidden /></span>
          : <Avatar id={item.other_profile_id} name={item.title} online={item.other_profile_id ? online.has(item.other_profile_id) : undefined} />}
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-base font-semibold text-ink dark:text-gray-100">{item.title ?? 'Conversation'}</h2>
          <p className="truncate text-xs text-ink/60 dark:text-gray-400">
            {item.kind === 'group' ? `${item.member_count ?? 0} members` : item.subtitle}
            {!isGroupish && item.other_profile_id ? ` · ${online.has(item.other_profile_id) ? 'Online' : 'Offline'}` : ''}{item.locked ? ' · Locked' : ''}
          </p>
        </div>
        <button type="button" aria-label="Search this conversation" aria-expanded={searchOpen} onClick={() => { setSearchOpen((v) => !v); setQ(''); }} className="rounded-full p-2 hover:bg-purple-50 dark:hover:bg-gray-800"><Search size={18} aria-hidden /></button>
        {item.kind === 'group' && item.is_owner && <button type="button" aria-label="Add members" onClick={() => setAdding((v) => !v)} className="rounded-full p-2 hover:bg-purple-50 dark:hover:bg-gray-800"><UserPlus size={18} aria-hidden /></button>}
        {item.kind === 'group' && <button type="button" aria-label="Leave the group" onClick={() => { if (window.confirm('Leave this group? You will no longer see its messages.')) leave.mutate(); }} className="rounded-full p-2 hover:bg-purple-50 dark:hover:bg-gray-800"><LogOut size={18} aria-hidden /></button>}
      </header>
      {searchOpen && (
        <div className="border-b border-purple-100 px-3 py-2 dark:border-gray-700">
          <label className="sr-only" htmlFor="thread-search">Search messages in this conversation</label>
          <input id="thread-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search messages…" className="w-full rounded-full border border-purple-200 px-4 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-800" />
          {q && <p className="mt-1 text-xs text-ink/60" role="status">{shown.length} {shown.length === 1 ? 'message' : 'messages'} found</p>}
        </div>
      )}
      {adding && <div className="border-b border-purple-100 p-3 dark:border-gray-700"><AddMembers conversationId={id} onDone={() => setAdding(false)} /></div>}

      <div className="flex-1 overflow-y-auto bg-purple-50/40 px-3 py-3 dark:bg-gray-950" aria-live="polite">
        {recent.isLoading && <p role="status" className="text-sm">Loading messages…</p>}
        {recent.isError && <p role="alert" className="text-sm text-danger">Could not load messages.</p>}
        {recent.data && recent.data.length >= 60 && <div className="mb-3 text-center"><button type="button" onClick={() => loadOlder.mutate()} disabled={loadOlder.isPending} className="rounded-full border border-purple-200 bg-white px-3 py-1 text-xs dark:border-gray-600 dark:bg-gray-800">{loadOlder.isPending ? 'Loading…' : 'Show earlier messages'}</button></div>}
        {recent.data && !all.length && <p className="mt-10 text-center text-sm text-ink/60 dark:text-gray-400">No messages yet. Say hello 👋</p>}
        {days.map((d) => (
          <div key={d.day} className="grid gap-2">
            <p className="my-2 text-center"><span className="rounded-full bg-white px-3 py-1 text-[11px] font-medium text-ink/60 shadow-sm dark:bg-gray-800 dark:text-gray-300">{dayLabel(d.day)}</span></p>
            {d.items.map((m) => (
              <Bubble key={m.id} m={m} mine={m.sender_id === profile?.id} showName={isGroupish} highlight={m.id === focusMessage}
                delivery={m.sender_id === profile?.id && item.kind !== 'cohort' ? deliveryState(m.created_at, reads.data ?? [], others) : null}
                canReact={canReact} canReply={item.can_post} onReply={() => setReplyTo(m)} onReact={(emoji) => react.mutate({ m: m.id, emoji })} />
            ))}
          </div>
        ))}
        <div ref={bottom} />
      </div>

      {item.can_post ? (
        <form onSubmit={(e: FormEvent) => { e.preventDefault(); send.mutate(); }} className="grid gap-2 border-t border-purple-100 p-3 dark:border-gray-700"
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
          {replyTo && (
            <div className="flex items-start justify-between gap-2 rounded-xl border-l-4 border-purple-500 bg-purple-50 px-3 py-2 text-xs dark:bg-gray-800">
              <span className="min-w-0"><span className="font-semibold">Replying to {replyTo.sender_id === profile?.id ? 'yourself' : replyTo.sender_name}</span><span className="block truncate text-ink/70 dark:text-gray-300">{replyTo.body}</span></span>
              <button type="button" aria-label="Cancel the reply" onClick={() => setReplyTo(null)} className="rounded-full p-1 hover:bg-purple-100"><X size={14} aria-hidden /></button>
            </div>
          )}
          <PendingFiles files={files} onRemove={(i) => setFiles(files.filter((_, j) => j !== i))} />
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <div className="flex items-end gap-1">
            <input ref={fileInput} type="file" multiple accept={FILE_ACCEPT} className="hidden" aria-label="Attach files" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            <button type="button" aria-label="Attach files" title={`Supported: ${SUPPORTED_SUMMARY}`} onClick={() => fileInput.current?.click()} className="rounded-full p-2 text-ink/60 hover:bg-purple-50 hover:text-purple-700 dark:text-gray-300 dark:hover:bg-gray-800"><Paperclip size={18} aria-hidden /></button>
            <AudioRecorder onDone={(f) => addFiles([f])} />
            <label htmlFor="chat-compose" className="sr-only">Message</label>
            <textarea id="chat-compose" rows={1} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKey} placeholder="Write a message…"
              className="max-h-40 min-h-[2.5rem] flex-1 resize-y rounded-2xl border border-purple-200 px-4 py-2 text-sm dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100" />
            <button type="submit" disabled={send.isPending} aria-label="Send" className="rounded-full bg-purple-700 p-2.5 text-white shadow hover:bg-purple-800 disabled:opacity-50"><Send size={18} aria-hidden /></button>
          </div>
          <p className="text-[11px] text-ink/50 dark:text-gray-400">Enter sends, Shift+Enter starts a new line. Files are checked for viruses before others can open them.</p>
        </form>
      ) : (
        <p className="border-t border-purple-100 p-3 text-center text-xs text-ink/60 dark:border-gray-700 dark:text-gray-400">{item.locked ? 'This conversation is locked by the programme team.' : 'You can read this conversation but not write in it.'}</p>
      )}
    </section>
  );
}

function Bubble({ m, mine, showName, highlight, delivery, canReact, canReply, onReply, onReact }: {
  m: api.ChatMessage; mine: boolean; showName: boolean; highlight: boolean; delivery: 'seen' | 'sent' | null; canReact: boolean; canReply: boolean;
  onReply: () => void; onReact: (emoji: string) => void;
}) {
  const [reporting, setReporting] = useState(false);
  const time = new Date(m.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return (
    <div id={`msg-${m.id}`} className={`group flex items-end gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
      {!mine && <Avatar id={m.sender_id} name={m.sender_name} size="sm" />}
      <div className={`grid max-w-[80%] gap-0.5 ${mine ? 'justify-items-end' : 'justify-items-start'}`}>
        <div className={`rounded-2xl px-3 py-2 text-sm shadow-sm ${highlight ? 'ring-2 ring-orange-400 outline outline-2 outline-offset-2 outline-orange-400' : ''} ${m.hidden ? 'bg-gray-100 italic text-ink/60 dark:bg-gray-800' : mine ? 'rounded-br-md bg-purple-700 text-white' : 'rounded-bl-md bg-white text-ink dark:bg-gray-800 dark:text-gray-100'}`}>
          {showName && !mine && !m.hidden && <p className="mb-0.5 text-xs font-semibold text-purple-700 dark:text-purple-300">{m.sender_name}</p>}
          {m.reply_to && !m.hidden && (
            <a href={`#msg-${m.reply_to}`} className={`mb-1 block rounded-lg border-l-4 px-2 py-1 text-xs ${mine ? 'border-orange-300 bg-white/15' : 'border-purple-400 bg-purple-50 dark:bg-gray-700'}`}>
              <span className="font-semibold">{m.reply_sender}</span><span className="block truncate opacity-80">{m.reply_body}</span>
            </a>
          )}
          {m.hidden ? <p>Message removed by a moderator</p> : <MessageText text={m.body ?? ''} mine={mine} />}
          {!m.hidden && m.attachments.length > 0 && <div className="mt-2 grid gap-2">{m.attachments.map((a) => <AttachmentView key={a.id} file={a} bucket="connect-attachments" />)}</div>}
          <p className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${mine ? 'text-purple-100' : 'text-ink/50 dark:text-gray-400'}`}>
            <time dateTime={m.created_at}>{time}</time>
            {delivery === 'seen' && <><CheckCheck size={12} aria-hidden /><span className="sr-only">Seen</span></>}
            {delivery === 'sent' && <><Check size={12} aria-hidden /><span className="sr-only">Sent</span></>}
          </p>
        </div>
        {!m.hidden && <ReactionBar reactions={m.reactions} onToggle={onReact} disabled={!canReact} />}
        {!m.hidden && (
          <div className="flex items-center gap-0.5 opacity-100 transition md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100">
            {canReact && QUICK_REACTIONS.slice(0, 3).map((e) => <button key={e} type="button" onClick={() => onReact(e)} aria-label={`React ${e}`} className="rounded-full px-1 text-base hover:scale-125"><span aria-hidden className="font-emoji">{e}</span></button>)}
            {canReact && <EmojiPicker onPick={onReact} />}
            {canReply && <button type="button" onClick={onReply} aria-label="Reply" className="rounded-full p-1.5 text-ink/60 hover:bg-purple-50 dark:text-gray-300 dark:hover:bg-gray-800"><CornerUpLeft size={16} aria-hidden /></button>}
            {!mine && <button type="button" onClick={() => setReporting((v) => !v)} aria-label="Report this message" className="rounded-full p-1.5 text-ink/60 hover:bg-purple-50 dark:text-gray-300 dark:hover:bg-gray-800"><Flag size={14} aria-hidden /></button>}
          </div>
        )}
        {reporting && <ReportForm messageId={m.id} onClose={() => setReporting(false)} />}
      </div>
    </div>
  );
}

function MessageText({ text, mine }: { text: string; mine: boolean }) {
  return (
    <p className="whitespace-pre-wrap break-words">
      {linkify(text).map((seg, i) => (seg.kind === 'text' ? <span key={i}>{seg.text}</span> : (
        <a key={i} href={seg.href} target="_blank" rel="noopener noreferrer nofollow ugc" className={`underline ${mine ? 'text-orange-100' : 'text-purple-700 dark:text-purple-300'}`} title={`Opens ${seg.host} in a new tab`}>{seg.text}</a>
      )))}
    </p>
  );
}

function ReportForm({ messageId, onClose }: { messageId: string; onClose: () => void }) {
  const [reason, setReason] = useState(''); const [note, setNote] = useState(''); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const report = useMutation({
    mutationFn: async () => { const bad = validateReport(reason, note); if (bad) throw new Error(bad); await api.reportMessage(messageId, reason, note.trim() || null); },
    onSuccess: () => setMsg({ ok: true, text: 'Thank you. The programme team will look at this.' }),
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });
  if (msg?.ok) return <p role="status" className="text-xs">{msg.text}</p>;
  return (
    <div className="grid w-72 max-w-full gap-2 rounded-xl border border-purple-100 bg-white p-3 text-xs dark:border-gray-700 dark:bg-gray-900">
      <label className="grid gap-1 font-medium">Why are you reporting this?
        <select className="rounded-lg border border-purple-200 px-2 py-1 dark:bg-gray-800" value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Choose a reason</option>{REPORT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
      </label>
      <label className="grid gap-1 font-medium">Anything else? (optional)<textarea className="rounded-lg border border-purple-200 px-2 py-1 dark:bg-gray-800" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      {msg && <p role="alert" className="text-danger">{msg.text}</p>}
      <div className="flex gap-2"><button type="button" disabled={report.isPending} onClick={() => report.mutate()} className="rounded-full bg-purple-700 px-3 py-1 font-semibold text-white">Send report</button><button type="button" onClick={onClose} className="rounded-full px-3 py-1">Cancel</button></div>
    </div>
  );
}

function AddMembers({ conversationId, onDone }: { conversationId: string; onDone: () => void }) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<api.Contact[]>([]); const [error, setError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => api.addMembers(conversationId, picked.map((p) => p.profile_id)),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['chat-inbox'] }); onDone(); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <div className="grid gap-2">
      <PeoplePicker picked={picked} onChange={setPicked} multiple />
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      <div className="flex gap-2"><button type="button" disabled={!picked.length || add.isPending} onClick={() => add.mutate()} className="rounded-full bg-purple-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">Add {picked.length || ''} to the group</button>
        <button type="button" onClick={onDone} className="rounded-full px-3 py-1 text-xs">Cancel</button></div>
    </div>
  );
}
