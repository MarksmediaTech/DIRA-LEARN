// Google Calendar sync status on the Calendar page (22 Nov 2026), for programme staff and trainers only.
// The DIRA LEARN calendar never depends on it: if the sync is not set up, Google is unavailable or the database change is not
// applied yet, this panel says so (or stays hidden) and everything else on the page works as before.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { describeFunctionError } from '@/lib/functionError';

import { QUEUE_ALL, canSeeGoogleSync, summarise, type SyncRow } from './googleSync';

export function GoogleSyncPanel({ role }: { role: string }) {
  const qc = useQueryClient();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const status = useQuery({
    queryKey: ['gcal-status'], refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from('gcal_events').select('state, last_error, synced_at, attempts').limit(2000);
      if (error) return null;                                   // the database change is not applied: hide the panel
      return summarise((data ?? []) as SyncRow[]);
    },
  });
  const configured = useQuery({
    queryKey: ['gcal-configured'], staleTime: 300_000,
    queryFn: async () => { const { data, error } = await supabase.functions.invoke('google-calendar-sync', { body: { action: 'status' } }); return error ? null : Boolean((data as { configured?: boolean })?.configured); },
  });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['gcal-status'] });
  const syncNow = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('google-calendar-sync', { body: {} });
      if (error) throw new Error((await describeFunctionError(error, 'Google Calendar could not be reached. Changes stay in the queue.')).message);
      return data as { processed: number; synced: number; failed: number };
    },
    onSuccess: (r) => { setNote({ ok: r.failed === 0, text: r.processed ? `Sent ${r.processed} change(s): ${r.synced} done, ${r.failed} failed.` : 'Nothing waiting: Google Calendar is up to date.' }); refresh(); },
    onError: (e: Error) => { setNote({ ok: false, text: e.message }); refresh(); },
  });
  const retry = useMutation({
    mutationFn: async () => { const { data, error } = await supabase.rpc('gcal_retry_failed'); if (error) throw new Error(error.message); return Number(data ?? 0); },
    onSuccess: (n) => { setNote({ ok: true, text: `${n} failed change(s) will be sent again.` }); refresh(); },
    onError: (e: Error) => setNote({ ok: false, text: e.message }),
  });
  const queueAll = useMutation({
    mutationFn: async () => { const { data, error } = await supabase.rpc('gcal_queue_all_future'); if (error) throw new Error(error.message); return Number(data ?? 0); },
    onSuccess: (n) => { setNote({ ok: true, text: `${n} upcoming session(s) queued for Google Calendar.` }); refresh(); },
    onError: (e: Error) => setNote({ ok: false, text: e.message }),
  });
  if (!canSeeGoogleSync(role) || !status.data) return null;
  const s = status.data;
  return (
    <section aria-labelledby="gcal-heading" className="grid gap-2 rounded-card border border-purple-100 bg-white p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="gcal-heading" className="font-display text-base font-semibold">Google Calendar sync</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${configured.data === false ? 'bg-slate-100 text-ink' : s.failed ? 'bg-red-50 text-danger' : s.waiting ? 'bg-orange-50 text-warn' : 'bg-green-50 text-ok'}`}>
          {configured.data === false ? 'Not set up' : s.failed ? `${s.failed} failed` : s.waiting ? `${s.waiting} waiting` : 'Up to date'}
        </span>
      </div>
      <p className="text-ink/70">
        {configured.data === false
          ? 'Google Calendar is not connected yet. The DIRA LEARN calendar works as usual; session changes wait in the queue and are sent once the connection is set up.'
          : `Sessions are copied one way to the organisation's Google Calendar. ${s.synced} in Google, ${s.waiting} waiting, ${s.failed} failed${s.lastSynced ? `; last sent ${new Date(s.lastSynced).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}.`}
      </p>
      {s.errors.length > 0 && <ul className="list-disc pl-5 text-xs text-danger" aria-label="Last sync errors">{s.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
      <div className="flex flex-wrap gap-2">
        {configured.data !== false && <button type="button" disabled={syncNow.isPending} onClick={() => syncNow.mutate()} className="rounded-full bg-purple-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-50">{syncNow.isPending ? 'Sending…' : 'Sync now'}</button>}
        {s.failed > 0 && <button type="button" disabled={retry.isPending} onClick={() => retry.mutate()} className="rounded-full border border-purple-200 px-3 py-1 text-xs font-semibold">Retry failed</button>}
        {QUEUE_ALL.includes(role) && <button type="button" disabled={queueAll.isPending} onClick={() => queueAll.mutate()} className="rounded-full border border-purple-200 px-3 py-1 text-xs">Send all upcoming sessions again</button>}
      </div>
      {note && <p role={note.ok ? 'status' : 'alert'} className={`text-xs ${note.ok ? 'text-ok' : 'text-danger'}`}>{note.text}</p>}
    </section>
  );
}
