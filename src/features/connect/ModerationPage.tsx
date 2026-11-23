import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useProgrammeTimezone } from '@/features/cohorts/useProgrammeTimezone';
import { formatInZone } from '@/lib/timezone';
import { EXECUTIVE_ROLES } from '@/lib/permissions';
import { MUTE_CHOICES, REPORT_REASONS, muteUntilIso, validateMuteReason, validateOversightReason, type Urgency } from './rules';

interface Report { id: string; created_at: string; reason: string; note: string | null; snapshot_body: string; sender_id: string; sender_name: string; conversation_id: string; conversation_kind: 'direct' | 'cohort'; conversation_title: string | null; status: string; handler_note: string | null }
interface Grant { profile_id: string; scope: 'discussions' | 'reports' | 'private'; reason: string; granted_at: string }
interface Person { id: string; first_name: string; last_name: string; role: string }
interface Thread { conversation_id: string; kind: string; title: string | null; locked: boolean }
interface OversightMsg { id: string; sender_name: string; body: string; created_at: string; hidden: boolean }
interface Mute { profile_id: string; until: string; reason: string }
interface RetentionRow { conversation_id: string; kind: string; messages: number; ends_on: string | null; purge_after: string | null; due: boolean; held: boolean; hold_reason: string | null }
interface Hold { id: string; conversation_id: string | null; participant_id: string | null; cohort_id: string | null; reason: string; placed_at: string; released_at: string | null }

const field = 'rounded-control border border-purple-200 px-3 py-2 font-normal';
const reasonLabel = (v: string) => REPORT_REASONS.find((r) => r.value === v)?.label ?? v;

export function ModerationPage() {
  const { profile } = useAuth();
  const isExecutive = !!profile && EXECUTIVE_ROLES.includes(profile.role);
  const mine = useQuery({
    queryKey: ['connect-my-grants', profile?.id], enabled: Boolean(profile),
    queryFn: async () => { const { data, error } = await supabase.from('connect_oversight').select('scope').eq('profile_id', profile?.id ?? ''); if (error) throw error; return ((data ?? []) as { scope: string }[]).map((g) => g.scope); },
  });
  const scopes = mine.data ?? [];
  const canModerate = isExecutive || scopes.includes('reports');
  const canReadPrivate = scopes.includes('private');
  return (
    <div className="grid gap-6">
      <h1 className="text-2xl font-bold text-purple-700">Connect moderation</h1>
      {mine.isLoading && <p role="status">Checking your permissions…</p>}
      {!mine.isLoading && !canModerate && <p role="status" className="rounded-card border border-purple-100 p-4 text-sm">You have not been given moderation permissions. A super administrator, Founder or Co-Founder can grant them.</p>}
      {canModerate && <Reports canReadPrivate={canReadPrivate} />}
      {canModerate && <Discussions />}
      {canModerate && <ScanQueue />}
      {canModerate && <Mutes />}
      {isExecutive && <Oversight myId={profile?.id ?? ''} />}
      {isExecutive && <Retention />}
    </div>
  );
}

function Reports({ canReadPrivate }: { canReadPrivate: boolean }) {
  const qc = useQueryClient();
  const { tz } = useProgrammeTimezone();
  const [status, setStatus] = useState('open');
  const [note, setNote] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<{ id: string; reason: string } | null>(null);
  const [readout, setReadout] = useState<OversightMsg[] | null>(null);

  const reports = useQuery({
    queryKey: ['connect-reports', status],
    queryFn: async () => { const { data, error: e } = await supabase.rpc('connect_list_reports', { p_status: status }); if (e) throw e; return (data ?? []) as Report[]; },
  });
  const handle = useMutation({
    mutationFn: async (v: { id: string; action: 'dismiss' | 'hide' | 'escalate'; urgency?: Urgency }) => { const { error: e } = await supabase.rpc('connect_handle_report', { p_report: v.id, p_action: v.action, p_note: note[v.id] ?? null, p_urgency: v.urgency ?? 'standard' }); if (e) throw e; },
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: ['connect-reports'] }); },
    onError: (e: Error) => setError(e.message),
  });
  const mute = useMutation({
    mutationFn: async (v: { profile: string; days: number }) => {
      const bad = validateMuteReason(note[`mute-${v.profile}`] ?? '');
      if (bad) throw new Error(`${bad} Write it in the note box first.`);
      const { error: e } = await supabase.rpc('connect_mute', { p_profile: v.profile, p_until: muteUntilIso(v.days), p_reason: (note[`mute-${v.profile}`] ?? '').trim() });
      if (e) throw e;
    },
    onSuccess: () => setError(null),
    onError: (e: Error) => setError(e.message),
  });
  const read = useMutation({
    mutationFn: async () => {
      if (!reading) return [] as OversightMsg[];
      const bad = validateOversightReason(reading.reason);
      if (bad) throw new Error(bad);
      const { data, error: e } = await supabase.rpc('connect_oversight_read', { p_conversation: reading.id, p_reason: reading.reason.trim() });
      if (e) throw e;
      return (data ?? []) as OversightMsg[];
    },
    onSuccess: (d) => { setError(null); setReadout(d); },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <section aria-labelledby="reports-heading" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="reports-heading" className="text-xl font-semibold">Reports</h2>
        <label className="flex items-center gap-2 text-sm font-medium">Show
          <select className={field} value={status} onChange={(e) => setStatus(e.target.value)}>{['open', 'escalated', 'hidden', 'dismissed', 'all'].map((s) => <option key={s} value={s}>{s}</option>)}</select>
        </label>
      </div>
      <p className="text-xs text-ink/60">A report shows only the reported message, never the rest of a private conversation. Escalating sends it to the designated Safeguarding Lead and Deputy as a confidential record; reports marked as a safety concern go to them automatically. You will not see the safeguarding record.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {reports.isLoading && <p role="status">Loading reports…</p>}
      {reports.isError && <p role="alert" className="text-danger">Could not load reports.</p>}
      {reports.data && reports.data.length === 0 && <EmptyState title="No reports">Nothing to review here.</EmptyState>}
      <ul className="grid gap-3">
        {(reports.data ?? []).map((r) => (
          <li key={r.id} className="grid gap-2 rounded-card border border-purple-100 p-4 text-sm">
            <p className="text-xs text-ink/60">{formatInZone(r.created_at, tz)} · {reasonLabel(r.reason)} · {r.conversation_kind === 'cohort' ? r.conversation_title : 'Private conversation'} · {r.status}</p>
            <p><strong>{r.sender_name}:</strong> <span className="whitespace-pre-wrap">{r.snapshot_body}</span></p>
            {r.note && <p className="text-xs">Reporter's note: {r.note}</p>}
            {r.handler_note && <p className="text-xs">Handler's note: {r.handler_note}</p>}
            <label className="grid gap-1 text-xs font-medium">Note (kept with the decision, also used as the reason when muting)
              <input className={field} value={note[r.id] ?? ''} maxLength={500} onChange={(e) => setNote((n) => ({ ...n, [r.id]: e.target.value, [`mute-${r.sender_id}`]: e.target.value }))} />
            </label>
            <div className="flex flex-wrap gap-2">
              {r.status === 'open' && <Button variant="quiet" disabled={handle.isPending} onClick={() => handle.mutate({ id: r.id, action: 'dismiss' })}>Dismiss</Button>}
              {(r.status === 'open' || r.status === 'escalated') && <Button variant="accent" disabled={handle.isPending} onClick={() => handle.mutate({ id: r.id, action: 'hide' })}>Hide message</Button>}
              {r.status === 'open' && <Button variant="accent" disabled={handle.isPending} onClick={() => { if (window.confirm('Escalate as URGENT? Both safeguarding officers are alerted at once.')) handle.mutate({ id: r.id, action: 'escalate', urgency: 'urgent' }); }}>Escalate: urgent</Button>}
              {r.status === 'open' && <Button variant="quiet" disabled={handle.isPending} onClick={() => handle.mutate({ id: r.id, action: 'escalate', urgency: 'standard' })}>Escalate: standard</Button>}
              {MUTE_CHOICES.map((c) => <Button key={c.days} variant="quiet" disabled={mute.isPending} onClick={() => mute.mutate({ profile: r.sender_id, days: c.days })}>Mute sender {c.label}</Button>)}
              {canReadPrivate && r.conversation_kind === 'direct' && <Button variant="quiet" onClick={() => { setReadout(null); setReading({ id: r.conversation_id, reason: '' }); }}>Read conversation (logged)</Button>}
            </div>
          </li>
        ))}
      </ul>
      {reading && (
        <div className="grid gap-2 rounded-card border border-orange-500 p-4 text-sm">
          <p className="font-semibold">Reading a private conversation</p>
          <p className="text-xs">This is recorded with your name, the time and your reason, and executives can review the log.</p>
          <label className="grid gap-1 font-medium">Reason (at least 10 characters)<input className={field} value={reading.reason} maxLength={300} onChange={(e) => setReading({ ...reading, reason: e.target.value })} /></label>
          <div className="flex gap-2"><Button disabled={read.isPending} onClick={() => read.mutate()}>Open conversation</Button><Button variant="quiet" onClick={() => { setReading(null); setReadout(null); }}>Close</Button></div>
          {readout && <ul className="grid gap-1">{[...readout].reverse().map((m) => <li key={m.id}><strong>{m.sender_name}</strong> · {formatInZone(m.created_at, tz)}{m.hidden ? ' · hidden from members (original shown)' : ''}<br /><span className="whitespace-pre-wrap">{m.body}</span></li>)}</ul>}
        </div>
      )}
    </section>
  );
}

function Discussions() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const threads = useQuery({
    queryKey: ['connect-threads-mod'],
    queryFn: async () => { const { data, error: e } = await supabase.rpc('connect_threads'); if (e) throw e; return ((data ?? []) as Thread[]).filter((t) => t.kind === 'cohort'); },
  });
  const lock = useMutation({
    mutationFn: async (v: { id: string; locked: boolean }) => { const { error: e } = await supabase.rpc('connect_set_lock', { p_conversation: v.id, p_locked: v.locked }); if (e) throw e; },
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: ['connect-threads-mod'] }); },
    onError: (e: Error) => setError(e.message),
  });
  if (!threads.data || threads.data.length === 0) return null;
  return (
    <section aria-labelledby="discussions-heading" className="grid gap-3">
      <h2 id="discussions-heading" className="text-xl font-semibold">Cohort discussions</h2>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <ul className="grid gap-2">
        {threads.data.map((t) => (
          <li key={t.conversation_id} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-purple-100 p-3 text-sm">
            <span>{t.title}{t.locked ? ' · Locked' : ''}</span>
            <Button variant={t.locked ? 'primary' : 'accent'} disabled={lock.isPending} onClick={() => lock.mutate({ id: t.conversation_id, locked: !t.locked })}>{t.locked ? 'Unlock' : 'Lock'}</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Executives choose who may moderate and who may read private conversations, and can review every private read. */
function Oversight({ myId }: { myId: string }) {
  const qc = useQueryClient();
  const { tz } = useProgrammeTimezone();
  const [error, setError] = useState<string | null>(null);
  const [who, setWho] = useState('');
  const [scope, setScope] = useState<Grant['scope']>('reports');
  const [reason, setReason] = useState('');
  const data = useQuery({
    queryKey: ['connect-oversight'],
    queryFn: async () => {
      const [g, p, l] = await Promise.all([
        supabase.from('connect_oversight').select('profile_id, scope, reason, granted_at').order('granted_at', { ascending: false }),
        supabase.from('profiles').select('id, first_name, last_name, role').in('role', ['super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator']).eq('status', 'active').order('last_name'),
        supabase.from('connect_oversight_log').select('id, profile_id, created_at, reason').order('created_at', { ascending: false }).limit(50),
      ]);
      if (g.error) throw g.error;
      if (p.error) throw p.error;
      if (l.error) throw l.error;
      return { grants: (g.data ?? []) as Grant[], people: (p.data ?? []) as Person[], log: (l.data ?? []) as { id: string; profile_id: string; created_at: string; reason: string }[] };
    },
  });
  const name = (id: string) => { const p = data.data?.people.find((x) => x.id === id); return p ? `${p.first_name} ${p.last_name}`.trim() : 'Someone'; };
  const grant = useMutation({
    mutationFn: async () => {
      if (!who) throw new Error('Choose a person.');
      const bad = reason.trim().length < 10 ? 'Write a reason of at least 10 characters. It is recorded.' : null;
      if (bad) throw new Error(bad);
      const { error: e } = await supabase.from('connect_oversight').insert({ profile_id: who, scope, reason: reason.trim() });
      if (e) throw e;
    },
    onSuccess: () => { setError(null); setReason(''); void qc.invalidateQueries({ queryKey: ['connect-oversight'] }); },
    onError: (e: Error) => setError(e.message),
  });
  const revoke = useMutation({
    mutationFn: async (g: Grant) => { const { error: e } = await supabase.from('connect_oversight').delete().eq('profile_id', g.profile_id).eq('scope', g.scope); if (e) throw e; },
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: ['connect-oversight'] }); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <section aria-labelledby="oversight-heading" className="grid gap-3">
      <h2 id="oversight-heading" className="text-xl font-semibold">Oversight permissions</h2>
      <p className="text-sm text-ink/70">Executives can read cohort discussions and handle reports. Nobody can read a private conversation unless named here with the <strong>private</strong> permission, and then only conversations that were reported or escalated; every read is logged below. You cannot grant a permission to yourself: another executive must do it. Safeguarding-team conversations can never be read through these permissions.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <form onSubmit={(e) => { e.preventDefault(); grant.mutate(); }} className="grid gap-2 rounded-card border border-purple-100 p-3 sm:grid-cols-3">
        <label className="grid gap-1 text-sm font-medium">Person<select className={field} value={who} onChange={(e) => setWho(e.target.value)}><option value="">Choose</option>{(data.data?.people ?? []).filter((p) => p.id !== myId).map((p) => <option key={p.id} value={p.id}>{`${p.first_name} ${p.last_name}`.trim()} · {p.role.replace(/_/g, ' ')}</option>)}</select></label>
        <label className="grid gap-1 text-sm font-medium">Permission<select className={field} value={scope} onChange={(e) => setScope(e.target.value as Grant['scope'])}><option value="reports">Handle reports and moderate</option><option value="discussions">Read cohort discussions</option><option value="private">Read reported private conversations</option></select></label>
        <label className="grid gap-1 text-sm font-medium">Reason<input className={field} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
        <div className="sm:col-span-3"><Button type="submit" disabled={grant.isPending}>Grant permission</Button></div>
      </form>
      <ul className="grid gap-2">
        {(data.data?.grants ?? []).map((g) => (
          <li key={`${g.profile_id}-${g.scope}`} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-purple-100 p-3 text-sm">
            <span><strong>{name(g.profile_id)}</strong> · {g.scope}<span className="block text-xs text-ink/60">{g.reason} · {formatInZone(g.granted_at, tz)}</span></span>
            <Button variant="quiet" disabled={revoke.isPending} onClick={() => revoke.mutate(g)}>Remove</Button>
          </li>
        ))}
      </ul>
      <h3 className="text-base font-semibold">Private conversation reads</h3>
      {(data.data?.log ?? []).length === 0 && <p className="text-sm text-ink/70">No private conversation has been read.</p>}
      <ul className="grid gap-1 text-xs">{(data.data?.log ?? []).map((l) => <li key={l.id}><strong>{formatInZone(l.created_at, tz)}</strong> · {name(l.profile_id)} · {l.reason}</li>)}</ul>
    </section>
  );
}

/** Current mutes, so a moderator can lift one early (they also expire on their own). */
function Mutes() {
  const qc = useQueryClient();
  const { tz } = useProgrammeTimezone();
  const [error, setError] = useState<string | null>(null);
  const mutes = useQuery({
    queryKey: ['connect-mutes'],
    queryFn: async () => { const { data, error: e } = await supabase.from('connect_mutes').select('profile_id, until, reason').gt('until', new Date().toISOString()); if (e) throw e; return (data ?? []) as Mute[]; },
  });
  const unmute = useMutation({
    mutationFn: async (id: string) => { const { error: e } = await supabase.rpc('connect_unmute', { p_profile: id }); if (e) throw e; },
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: ['connect-mutes'] }); }, onError: (e: Error) => setError(e.message),
  });
  if (!mutes.data || mutes.data.length === 0) return null;
  return (
    <section aria-labelledby="mutes-heading" className="grid gap-2">
      <h2 id="mutes-heading" className="text-xl font-semibold">Muted in discussions</h2>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <ul className="grid gap-2">{mutes.data.map((m) => (
        <li key={m.profile_id} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-purple-100 p-3 text-sm">
          <span>Muted until {formatInZone(m.until, tz)} · {m.reason}</span>
          <Button variant="quiet" disabled={unmute.isPending} onClick={() => unmute.mutate(m.profile_id)}>Unmute</Button>
        </li>))}</ul>
    </section>
  );
}

/** Retention of ordinary messages (12 months after the cohort ends) and legal holds. Executives only. */
function Retention() {
  const qc = useQueryClient();
  const { tz } = useProgrammeTimezone();
  const [error, setError] = useState<string | null>(null);
  const [cohort, setCohort] = useState(''); const [reason, setReason] = useState('');
  const data = useQuery({
    queryKey: ['connect-retention'],
    queryFn: async () => {
      const [s, r, h, c] = await Promise.all([
        supabase.from('connect_retention_settings').select('enabled, months').single(),
        supabase.rpc('connect_retention_status'),
        supabase.from('connect_legal_holds').select('*').is('released_at', null).order('placed_at', { ascending: false }),
        supabase.from('cohorts').select('id, name').order('start_date', { ascending: false }),
      ]);
      if (s.error) throw s.error; if (r.error) throw r.error; if (h.error) throw h.error; if (c.error) throw c.error;
      return { settings: s.data as { enabled: boolean; months: number }, rows: (r.data ?? []) as RetentionRow[], holds: (h.data ?? []) as Hold[], cohorts: (c.data ?? []) as { id: string; name: string }[] };
    },
  });
  const refresh = () => { setError(null); void qc.invalidateQueries({ queryKey: ['connect-retention'] }); };
  const toggle = useMutation({
    mutationFn: async (enabled: boolean) => { const { error: e } = await supabase.from('connect_retention_settings').update({ enabled }).eq('id', true); if (e) throw e; },
    onSuccess: refresh, onError: (e: Error) => setError(e.message),
  });
  const place = useMutation({
    mutationFn: async () => {
      if (!cohort) throw new Error('Choose a cohort.');
      if (reason.trim().length < 10) throw new Error('Write a reason of at least 10 characters.');
      const { error: e } = await supabase.rpc('connect_place_hold', { p_conversation: null, p_participant: null, p_cohort: cohort, p_reason: reason.trim() }); if (e) throw e;
    },
    onSuccess: () => { setCohort(''); setReason(''); refresh(); }, onError: (e: Error) => setError(e.message),
  });
  const release = useMutation({
    mutationFn: async (id: string) => {
      const r = window.prompt('Why is this legal hold being released? (at least 10 characters, recorded)') ?? '';
      if (r.trim().length < 10) throw new Error('A reason of at least 10 characters is needed to release a hold.');
      const { error: e } = await supabase.rpc('connect_release_hold', { p_hold: id, p_reason: r.trim() }); if (e) throw e;
    },
    onSuccess: refresh, onError: (e: Error) => setError(e.message),
  });
  if (!data.data) return null;
  const { settings, rows, holds, cohorts } = data.data;
  const due = rows.filter((r) => r.due && !r.held);
  const cohortName = (id: string | null) => cohorts.find((c) => c.id === id)?.name ?? 'a conversation or learner';
  return (
    <section aria-labelledby="retention-heading" className="grid gap-3">
      <h2 id="retention-heading" className="text-xl font-semibold">Message retention</h2>
      <p className="text-sm text-ink/70">Ordinary messages are deleted {settings.months} months after the learner&apos;s (or cohort&apos;s) last cohort ends, only while retention is switched on. Never deleted: safeguarding-team conversations, conversations with a report, conversations linked to a safeguarding record, and anything under a legal hold.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap items-center gap-3 rounded-card border border-purple-100 p-3 text-sm">
        <span>Retention is <strong>{settings.enabled ? 'ON' : 'OFF'}</strong>. {due.length} conversation(s) are past the period and would be deleted at the next scheduled run{settings.enabled ? '' : ' if switched on'}. {rows.filter((r) => r.held).length} are protected.</span>
        <Button variant={settings.enabled ? 'quiet' : 'accent'} disabled={toggle.isPending} onClick={() => { if (window.confirm(settings.enabled ? 'Switch retention OFF? Nothing will be deleted.' : `Switch retention ON? ${due.length} conversation(s) will be permanently deleted at the next scheduled run.`)) toggle.mutate(!settings.enabled); }}>{settings.enabled ? 'Switch off' : 'Switch on'}</Button>
      </div>
      <form className="grid gap-2 rounded-card border border-purple-100 p-3 text-sm sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); place.mutate(); }}>
        <label className="grid gap-1 font-medium">Legal hold on a cohort<select className={field} value={cohort} onChange={(e) => setCohort(e.target.value)}><option value="">Choose</option>{cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label className="grid gap-1 font-medium sm:col-span-2">Reason<input className={field} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
        <div className="sm:col-span-3"><Button type="submit" disabled={place.isPending}>Place legal hold</Button></div>
      </form>
      <ul className="grid gap-2 text-sm">{holds.map((h) => (
        <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-card border border-purple-100 p-3">
          <span>Hold on {h.cohort_id ? cohortName(h.cohort_id) : 'a conversation or learner'} since {formatInZone(h.placed_at, tz)} · {h.reason}</span>
          <Button variant="quiet" disabled={release.isPending} onClick={() => release.mutate(h.id)}>Release</Button>
        </li>))}</ul>
    </section>
  );
}

/** Files waiting for a virus check. If the number only grows, no scanner is configured (see docs/ATTACHMENT_SECURITY.md). */
function ScanQueue() {
  const { tz } = useProgrammeTimezone();
  const q = useQuery({
    queryKey: ['connect-scan-queue'],
    queryFn: async () => { const { data, error } = await supabase.rpc('connect_scan_queue'); if (error) throw error; return ((data ?? []) as { pending: number; scanning: number; clean: number; infected: number; scan_failed: number; oldest_pending: string | null }[])[0] ?? null; },
  });
  const d = q.data;
  if (!d || d.pending + d.scanning + d.clean + d.infected + d.scan_failed === 0) return null;
  return (
    <section aria-labelledby="scan-heading" className="grid gap-1 rounded-card border border-purple-100 p-3 text-sm">
      <h2 id="scan-heading" className="text-xl font-semibold">Attachment virus checks</h2>
      <p>{d.pending + d.scanning} waiting · {d.clean} clean · {d.infected} blocked · {d.scan_failed} could not be checked</p>
      {d.oldest_pending && <p className="text-xs text-ink/60">Oldest waiting since {formatInZone(d.oldest_pending, tz)}. Files cannot be opened until they are checked. If this keeps growing, no virus scanner is set up yet.</p>}
    </section>
  );
}
