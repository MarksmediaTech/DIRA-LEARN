// Announcements inside Chat (22 Nov 2026): staff publish news and learning materials (files, voice recordings) to everyone,
// a track or a cohort they may address; learners read, download and react with emoji (no replies here - they use conversations).
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Megaphone, Paperclip, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import * as api from './api';
import { AttachmentView, AudioRecorder, Avatar, EmojiPicker, PendingFiles, ReactionBar } from './parts';
import { AUDIENCES, FILE_ACCEPT, MAX_FILES_PER_ANNOUNCEMENT, SUPPORTED_SUMMARY, announcementProblem, fileProblem, type Audience } from './rules';

const STAFF_ROLES = ['super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator', 'trainer', 'mentor', 'me_officer'];
export const canPublish = (role: string | null | undefined): boolean => STAFF_ROLES.includes(role ?? '');

export function Announcements({ focus }: { focus: string | null }) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const feed = useQuery({ queryKey: ['chat-announcements'], queryFn: api.announcements, refetchInterval: 60_000 });
  useEffect(() => {
    const ch = supabase.channel('chat-announcements')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, () => void qc.invalidateQueries({ queryKey: ['chat-announcements'] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcement_reactions' }, () => void qc.invalidateQueries({ queryKey: ['chat-announcements'] }))
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [qc]);
  useEffect(() => { if (focus && feed.data) document.getElementById(`ann-${focus}`)?.scrollIntoView?.({ block: 'start' }); }, [focus, feed.data]);
  const staff = canPublish(profile?.role);
  return (
    <div className="grid gap-4">
      {staff && <Composer />}
      {feed.isLoading && <p role="status" className="text-sm">Loading announcements…</p>}
      {feed.isError && <p role="alert" className="text-sm text-danger">Could not load announcements.</p>}
      {feed.data && !feed.data.length && (
        <div className="dira-panel rounded-2xl border border-dashed border-purple-200 p-8 text-center text-sm text-ink/70 dark:border-gray-700 dark:text-gray-300">
          <Megaphone className="mx-auto mb-2 text-purple-600" size={28} aria-hidden />
          No announcements yet. Programme news and learning materials will appear here.
        </div>
      )}
      <ul className="grid gap-3">
        {(feed.data ?? []).map((a) => <li key={a.id}><AnnouncementCard a={a} highlight={a.id === focus} /></li>)}
      </ul>
    </div>
  );
}

function Composer() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(''); const [body, setBody] = useState('');
  const [audience, setAudience] = useState<Audience>('everyone'); const [cohortId, setCohortId] = useState(''); const [trackId, setTrackId] = useState('');
  const [pinned, setPinned] = useState(false); const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null); const [done, setDone] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const choices = useQuery({ queryKey: ['chat-audiences'], queryFn: api.audienceChoices, enabled: open });
  const publish = useMutation({
    mutationFn: async () => {
      const bad = announcementProblem({ title, body, audience, cohortId, trackId }) ?? fileProblem(files, MAX_FILES_PER_ANNOUNCEMENT);
      if (bad) throw new Error(bad);
      if (!body.trim() && !files.length) throw new Error('Write the announcement or attach a file or recording.');
      return api.publishAnnouncement({ title, body, audience, cohortId, trackId, pinned }, files);
    },
    onSuccess: ({ fileErrors }) => {
      setDone(fileErrors.length ? `Published, but some files could not be added: ${fileErrors.join('; ')}` : 'Published. Everyone addressed has been notified.');
      setTitle(''); setBody(''); setFiles([]); setPinned(false); setError(null); setOpen(false);
      void qc.invalidateQueries({ queryKey: ['chat-announcements'] });
    },
    onError: (e: Error) => setError(e.message),
  });
  const addFiles = (list: FileList | File[] | null) => {
    const next = [...files, ...Array.from(list ?? [])]; const bad = fileProblem(next, MAX_FILES_PER_ANNOUNCEMENT);
    if (bad) { setError(bad); return; } setError(null); setFiles(next);
  };
  const field = 'rounded-xl border border-purple-200 px-3 py-2 text-sm font-normal dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';
  if (!open) {
    return (
      <div className="grid gap-2">
        {done && <p role="status" className="rounded-xl bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950 dark:text-green-200">{done}</p>}
        <button type="button" onClick={() => { setOpen(true); setDone(null); }} className="dira-panel flex items-center gap-3 rounded-2xl border border-purple-100 bg-white p-4 text-left text-sm text-ink/70 shadow-sm hover:border-purple-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300">
          <Megaphone size={20} aria-hidden className="text-purple-700" /> Share an announcement or learning material…
        </button>
      </div>
    );
  }
  return (
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); publish.mutate(); }} className="dira-panel grid gap-3 rounded-2xl border border-purple-100 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-900"
      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
      <h2 className="font-display text-lg font-semibold">New announcement</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-medium">Who should see it
          <select className={field} value={audience} onChange={(e) => setAudience(e.target.value as Audience)}>{AUDIENCES.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select>
        </label>
        {audience === 'cohort' && (
          <label className="grid gap-1 text-sm font-medium">Cohort
            <select className={field} value={cohortId} onChange={(e) => setCohortId(e.target.value)}><option value="">Choose…</option>{(choices.data?.cohorts ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </label>
        )}
        {audience === 'track' && (
          <label className="grid gap-1 text-sm font-medium">Track
            <select className={field} value={trackId} onChange={(e) => setTrackId(e.target.value)}><option value="">Choose…</option>{(choices.data?.tracks ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          </label>
        )}
      </div>
      <label className="grid gap-1 text-sm font-medium">Title<input className={field} value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} /></label>
      <label className="grid gap-1 text-sm font-medium">Message<textarea className={field} rows={4} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} /></label>
      <PendingFiles files={files} onRemove={(i) => setFiles(files.filter((_, j) => j !== i))} />
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileInput} type="file" multiple accept={FILE_ACCEPT} className="hidden" aria-label="Attach learning materials" onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        <button type="button" onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-2 rounded-full border border-purple-200 px-3 py-1.5 text-sm hover:bg-purple-50 dark:border-gray-600 dark:hover:bg-gray-800"><Paperclip size={16} aria-hidden /> Attach materials</button>
        <span className="inline-flex items-center gap-1 text-sm">Record audio <AudioRecorder onDone={(f) => addFiles([f])} maxSeconds={900} /></span>
        <label className="ml-auto inline-flex items-center gap-2 text-sm"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Pin to the top</label>
      </div>
      <p className="text-xs text-ink/60 dark:text-gray-400">Supported: {SUPPORTED_SUMMARY}. Up to {MAX_FILES_PER_ANNOUNCEMENT} files. Files are checked for viruses before learners can open them. Everyone addressed is notified.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={publish.isPending} className="rounded-full bg-purple-700 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-800 disabled:opacity-50">{publish.isPending ? 'Publishing…' : 'Publish'}</button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-full px-4 py-2 text-sm">Cancel</button>
      </div>
    </form>
  );
}

function AnnouncementCard({ a, highlight }: { a: api.AnnouncementItem; highlight: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false); const [title, setTitle] = useState(a.title); const [body, setBody] = useState(a.body);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['chat-announcements'] });
  const react = useMutation({ mutationFn: (emoji: string) => api.reactAnnouncement(a.id, emoji), onSuccess: refresh, onError: (e: Error) => setError(e.message) });
  const save = useMutation({
    mutationFn: () => { if (title.trim().length < 3) throw new Error('Give the announcement a title.'); return api.updateAnnouncement(a.id, { title: title.trim(), body: body.trim() }); },
    onSuccess: () => { setEditing(false); setError(null); refresh(); }, onError: (e: Error) => setError(e.message),
  });
  const pin = useMutation({ mutationFn: () => api.updateAnnouncement(a.id, { pinned: !a.pinned }), onSuccess: refresh, onError: (e: Error) => setError(e.message) });
  const remove = useMutation({ mutationFn: () => api.deleteAnnouncement(a.id, a.attachments), onSuccess: refresh, onError: (e: Error) => setError(e.message) });
  const date = new Date(a.created_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return (
    <article id={`ann-${a.id}`} aria-labelledby={`ann-title-${a.id}`} className={`dira-panel rounded-2xl border bg-white p-4 shadow-sm dark:bg-gray-900 ${highlight ? 'border-orange-400 ring-2 ring-orange-200 outline outline-2 outline-offset-2 outline-orange-400' : 'border-purple-100 dark:border-gray-700'}`}>
      <header className="flex items-start gap-3">
        <Avatar id={a.created_by} name={a.author_name} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{a.author_name}</p>
          <p className="text-xs text-ink/60 dark:text-gray-400"><time dateTime={a.created_at}>{date}</time> · {a.audience_label}{a.edited_at ? ' · edited' : ''}</p>
        </div>
        {a.pinned && <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800 dark:bg-orange-950 dark:text-orange-200"><Pin size={12} aria-hidden /> Pinned</span>}
      </header>
      {editing ? (
        <div className="mt-3 grid gap-2">
          <label className="grid gap-1 text-sm font-medium">Title<input className="rounded-xl border border-purple-200 px-3 py-2 dark:bg-gray-800" value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="grid gap-1 text-sm font-medium">Message<textarea className="rounded-xl border border-purple-200 px-3 py-2 dark:bg-gray-800" rows={4} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)} /></label>
          <div className="flex gap-2"><button type="button" disabled={save.isPending} onClick={() => save.mutate()} className="rounded-full bg-purple-700 px-3 py-1 text-sm font-semibold text-white">Save</button><button type="button" onClick={() => setEditing(false)} className="rounded-full px-3 py-1 text-sm">Cancel</button></div>
        </div>
      ) : (
        <>
          <h3 id={`ann-title-${a.id}`} className="mt-3 font-display text-lg font-semibold text-ink dark:text-gray-100">{a.title}</h3>
          {a.body && <p className="mt-1 whitespace-pre-wrap text-sm text-ink/90 dark:text-gray-200">{a.body}</p>}
        </>
      )}
      {a.attachments.length > 0 && (
        <div className="mt-3 grid gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/60 dark:text-gray-400">Materials</p>
          {a.attachments.map((f) => <AttachmentView key={f.id} file={f} bucket="announcement-files" />)}
        </div>
      )}
      <footer className="mt-3 flex flex-wrap items-center gap-2">
        <ReactionBar reactions={a.reactions} onToggle={(e) => react.mutate(e)} />
        <EmojiPicker onPick={(e) => react.mutate(e)} label="React to this announcement" />
        {a.can_edit && (
          <span className="ml-auto flex gap-1">
            <button type="button" onClick={() => setEditing(true)} aria-label="Edit" className="rounded-full p-1.5 text-ink/60 hover:bg-purple-50 dark:hover:bg-gray-800"><Pencil size={16} aria-hidden /></button>
            <button type="button" onClick={() => pin.mutate()} aria-label={a.pinned ? 'Unpin' : 'Pin to the top'} className="rounded-full p-1.5 text-ink/60 hover:bg-purple-50 dark:hover:bg-gray-800">{a.pinned ? <PinOff size={16} aria-hidden /> : <Pin size={16} aria-hidden />}</button>
            <button type="button" onClick={() => { if (window.confirm('Delete this announcement and its files? This cannot be undone.')) remove.mutate(); }} aria-label="Delete" className="rounded-full p-1.5 text-ink/60 hover:bg-red-50 hover:text-red-700 dark:hover:bg-gray-800"><Trash2 size={16} aria-hidden /></button>
          </span>
        )}
      </footer>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    </article>
  );
}
