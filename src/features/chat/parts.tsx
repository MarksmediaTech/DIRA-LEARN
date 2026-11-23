// Small building blocks of the Chat screens (22 Nov 2026): avatar, emoji picker and reactions, attachments, audio recorder.
import { useEffect, useRef, useState } from 'react';
import { FileText, Mic, Pause, Play, Square, Trash2, Download, SmilePlus, Paperclip, X } from 'lucide-react';
import { canDownload, scanLabel } from '@/features/connect/rules';
import { REACTIONS, avatarColour, categoryOf, formatBytes, initials } from './rules';
import { fileLink, type FileRef, type Reaction } from './api';

export function Avatar({ id, name, size = 'md', online }: { id: string | null; name: string | null; size?: 'sm' | 'md' | 'lg'; online?: boolean }) {
  const dim = size === 'sm' ? 'h-8 w-8 text-xs' : size === 'lg' ? 'h-12 w-12 text-base' : 'h-10 w-10 text-sm';
  return (
    <span className="relative inline-flex shrink-0">
      <span aria-hidden className={`${dim} ${avatarColour(id)} inline-flex items-center justify-center rounded-full font-semibold text-white`}>{initials(name)}</span>
      {online !== undefined && (
        <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full ring-2 ring-white dark:ring-gray-900 ${online ? 'bg-green-500' : 'bg-gray-300'}`}>
          <span className="sr-only">{online ? 'Online' : 'Offline'}</span>
        </span>
      )}
    </span>
  );
}

/** Popover grid of the reaction emoji. Keyboard: Tab through, Enter to pick, Escape to close. */
export function EmojiPicker({ onPick, label = 'Add a reaction' }: { onPick: (emoji: string) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  return (
    <div ref={ref} className="relative inline-block">
      <button type="button" aria-label={label} aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className="rounded-full p-1.5 text-ink/60 hover:bg-purple-50 hover:text-purple-700 focus-visible:outline-purple-600 dark:text-gray-300 dark:hover:bg-gray-800">
        <SmilePlus size={18} aria-hidden />
      </button>
      {open && (
        <div role="dialog" aria-label="Choose an emoji" className="absolute bottom-full z-30 mb-2 grid w-64 grid-cols-8 gap-1 rounded-2xl border border-purple-100 bg-white p-2 shadow-xl dark:border-gray-700 dark:bg-gray-900">
          {REACTIONS.map((r) => (
            <button key={r.emoji} type="button" title={r.label} aria-label={r.label} onClick={() => { onPick(r.emoji); setOpen(false); }}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-xl leading-none transition hover:scale-125 hover:bg-purple-50 focus-visible:outline-purple-600 dark:hover:bg-gray-800">
              <span aria-hidden className="font-emoji">{r.emoji}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReactionBar({ reactions, onToggle, disabled }: { reactions: Reaction[]; onToggle: (emoji: string) => void; disabled?: boolean }) {
  if (!reactions.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {reactions.map((r) => (
        <button key={r.emoji} type="button" disabled={disabled} onClick={() => onToggle(r.emoji)} aria-pressed={r.mine}
          aria-label={`${REACTIONS.find((x) => x.emoji === r.emoji)?.label ?? r.emoji}: ${r.count}${r.mine ? ', including you' : ''}`}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition ${r.mine ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/40' : 'border-purple-100 bg-white dark:border-gray-700 dark:bg-gray-800'}`}>
          <span aria-hidden className="font-emoji text-sm">{r.emoji}</span><span className="tabular-nums">{r.count}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * One attachment: images, audio and video play inside Chat; documents show name, size and a download button.
 * Conversation files open only after a clean virus scan (database rule); announcement files follow migration 35's rule.
 */
export function AttachmentView({ file, bucket }: { file: FileRef; bucket: 'connect-attachments' | 'announcement-files' }) {
  const cat = categoryOf(file.mime);
  const allowed = bucket === 'announcement-files' || canDownload(file.scan ?? '');
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!allowed || (cat !== 'image' && cat !== 'audio' && cat !== 'video')) return;
    let live = true;
    void fileLink(bucket, file.path).then((u) => { if (live) { if (u) setUrl(u); else setError('Not available yet (waiting for a virus check).'); } });
    return () => { live = false; };
  }, [allowed, bucket, cat, file.path]);
  const download = async () => {
    setError(null);
    const u = await fileLink(bucket, file.path, file.name);
    if (!u) { setError('This file cannot be opened yet. It may still be waiting for a virus check.'); return; }
    window.open(u, '_blank', 'noopener,noreferrer');
  };
  if (!allowed) {
    return <p className="rounded-xl border border-dashed border-purple-200 px-3 py-2 text-xs text-ink/70 dark:border-gray-600 dark:text-gray-300">{file.name} ({formatBytes(file.size)}) · {scanLabel(file.scan ?? '')}</p>;
  }
  return (
    <div className="grid gap-1">
      {cat === 'image' && url && <img src={url} alt={file.name} className="max-h-64 max-w-full rounded-xl object-contain" loading="lazy" />}
      {cat === 'audio' && url && <audio controls preload="metadata" src={url} className="w-64 max-w-full"><track kind="captions" /></audio>}
      {cat === 'video' && url && <video controls preload="metadata" src={url} className="max-h-72 max-w-full rounded-xl"><track kind="captions" /></video>}
      <button type="button" onClick={() => void download()}
        className="inline-flex max-w-full items-center gap-2 justify-self-start rounded-xl border border-purple-100 bg-white px-3 py-2 text-left text-xs hover:bg-purple-50 dark:border-gray-700 dark:bg-gray-800 dark:hover:bg-gray-700">
        {cat === 'document' ? <FileText size={16} aria-hidden className="shrink-0 text-purple-700" /> : <Download size={16} aria-hidden className="shrink-0 text-purple-700" />}
        <span className="truncate font-medium">{file.name}</span><span className="shrink-0 text-ink/60 dark:text-gray-400">{formatBytes(file.size)}</span>
        <span className="sr-only">Download</span>
      </button>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
    </div>
  );
}

/** Chips for files chosen but not sent yet, with remove buttons. */
export function PendingFiles({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  if (!files.length) return null;
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Files to send">
      {files.map((f, i) => (
        <li key={`${f.name}-${i}`} className="inline-flex items-center gap-2 rounded-full bg-purple-50 px-3 py-1 text-xs dark:bg-gray-800">
          <Paperclip size={12} aria-hidden /> <span className="max-w-[12rem] truncate">{f.name}</span> <span className="text-ink/60">{formatBytes(f.size)}</span>
          <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onRemove(i)} className="rounded-full p-0.5 hover:bg-purple-100"><X size={12} aria-hidden /></button>
        </li>
      ))}
    </ul>
  );
}

const pickRecorderType = (): string => {
  const MR = (window as unknown as { MediaRecorder?: { isTypeSupported?: (t: string) => boolean } }).MediaRecorder;
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) if (MR?.isTypeSupported?.(t)) return t;
  return 'audio/webm';
};

/**
 * Record a voice message with the device microphone (the browser asks for permission). Preview, play back, delete or send.
 * Nothing leaves the device until "Use recording" is pressed; the result is handed over as a File like any attachment.
 */
export function AudioRecorder({ onDone, maxSeconds = 300 }: { onDone: (file: File) => void; maxSeconds?: number }) {
  const [state, setState] = useState<'idle' | 'recording' | 'preview'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [clip, setClip] = useState<{ blob: Blob; url: string } | null>(null);
  const rec = useRef<MediaRecorder | null>(null); const chunks = useRef<Blob[]>([]); const timer = useRef<number | null>(null); const stream = useRef<MediaStream | null>(null);
  const stopTracks = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; if (timer.current) window.clearInterval(timer.current); timer.current = null; };
  useEffect(() => () => { stopTracks(); if (clip) URL.revokeObjectURL(clip.url); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const start = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') { setError('This browser cannot record audio. You can attach an audio file instead.'); return; }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = pickRecorderType();
      const r = new MediaRecorder(stream.current, { mimeType: type }); chunks.current = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.current.push(e.data); };
      r.onstop = () => { const blob = new Blob(chunks.current, { type: type.split(';')[0] }); setClip({ blob, url: URL.createObjectURL(blob) }); setState('preview'); stopTracks(); };
      rec.current = r; r.start(); setSeconds(0); setState('recording');
      timer.current = window.setInterval(() => setSeconds((s) => { if (s + 1 >= maxSeconds) rec.current?.stop(); return s + 1; }), 1000);
    } catch {
      stopTracks(); setError('Microphone not available. Allow microphone access in your browser, or attach an audio file.');
    }
  };
  const discard = () => { if (clip) URL.revokeObjectURL(clip.url); setClip(null); setState('idle'); setSeconds(0); };
  const use = () => {
    if (!clip) return;
    const ext = clip.blob.type.includes('ogg') ? 'ogg' : clip.blob.type.includes('mp4') ? 'm4a' : 'webm';
    onDone(new File([clip.blob], `voice-message-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.${ext}`, { type: clip.blob.type }));
    discard();
  };
  const mmss = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  return (
    <div className="inline-flex flex-wrap items-center gap-2">
      {state === 'idle' && (
        <button type="button" onClick={() => void start()} aria-label="Record a voice message"
          className="rounded-full p-2 text-ink/60 hover:bg-purple-50 hover:text-purple-700 focus-visible:outline-purple-600 dark:text-gray-300 dark:hover:bg-gray-800"><Mic size={18} aria-hidden /></button>
      )}
      {state === 'recording' && (
        <span className="inline-flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-xs text-red-700 dark:bg-red-950 dark:text-red-200" role="status">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" aria-hidden /> Recording {mmss}
          <button type="button" onClick={() => rec.current?.stop()} aria-label="Stop recording" className="rounded-full p-1 hover:bg-red-100"><Square size={14} aria-hidden /></button>
        </span>
      )}
      {state === 'preview' && clip && (
        <span className="inline-flex flex-wrap items-center gap-2 rounded-2xl bg-purple-50 px-3 py-1 text-xs dark:bg-gray-800">
          <PreviewPlayer url={clip.url} /> <span className="tabular-nums">{mmss}</span>
          <button type="button" onClick={discard} aria-label="Delete the recording" className="rounded-full p-1 hover:bg-purple-100"><Trash2 size={14} aria-hidden /></button>
          <button type="button" onClick={use} className="rounded-full bg-purple-700 px-3 py-1 font-semibold text-white hover:bg-purple-800">Use recording</button>
        </span>
      )}
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </div>
  );
}
function PreviewPlayer({ url }: { url: string }) {
  const a = useRef<HTMLAudioElement>(null); const [playing, setPlaying] = useState(false);
  return (
    <>
      <audio ref={a} src={url} onEnded={() => setPlaying(false)} className="hidden"><track kind="captions" /></audio>
      <button type="button" aria-label={playing ? 'Pause' : 'Play the recording'} onClick={() => { if (!a.current) return; if (playing) { a.current.pause(); setPlaying(false); } else { void a.current.play(); setPlaying(true); } }}
        className="rounded-full p-1 hover:bg-purple-100">{playing ? <Pause size={14} aria-hidden /> : <Play size={14} aria-hidden />}</button>
    </>
  );
}
