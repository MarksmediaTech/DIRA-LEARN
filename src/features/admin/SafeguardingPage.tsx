import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { EXECUTIVE_ROLES } from '@/lib/permissions';
import { useProgrammeTimezone } from '@/features/cohorts/useProgrammeTimezone';
import { formatInZone } from '@/lib/timezone';
import type { SafeguardingRecord } from '@/types/database';
import {
  OFFICER_ELIGIBLE_ROLES, POSITION_LABEL, myPositionText, type MyPosition, SG_NEXT_STATUSES, SG_STATUS_LABEL, SOURCE_LABEL, URGENCY_LABEL, ackState, ackText, canRaiseConcern,
  sortForOfficer, validateAppointmentReason, validateConcern, validateExceptionalReason, validateReadReason, type SgStatus,
} from './safeguardingRules';

// Migration 24. The database decides everything shown here: only the designated Lead and Deputy can read records.
const field = 'rounded-control border border-purple-200 px-3 py-2 font-normal';
type Position = 'lead' | 'deputy';
interface Officer { officer_position: Position; profile_id: string; display_name: string; appointed_at: string; unavailable_until: string | null; acting: boolean }
interface Person { id: string; first_name: string; last_name: string; role: string }
interface Row extends SafeguardingRecord { participants: { participant_no: string; profiles: { first_name: string; last_name: string } | null } | null }
interface Action { id: string; record_id: string; action: string; from_status: string | null; to_status: string | null; note: string | null; actor_id: string | null; created_at: string }
interface Grant { id: string; profile_id: string; reason: string; granted_by: string; granted_at: string; expires_at: string; revoked_at: string | null }
interface LogRow { id: string; profile_id: string; record_id: string | null; conversation_id: string | null; basis: string; reason: string; created_at: string }

const fullName = (p: { first_name: string; last_name: string } | null | undefined) => (p ? `${p.first_name} ${p.last_name}`.trim() : '');
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function SafeguardingPage() {
  const { profile } = useAuth();
  const isExecutive = !!profile && EXECUTIVE_ROLES.includes(profile.role);
  const me = useQuery({
    queryKey: ['sg-me', profile?.id], enabled: Boolean(profile),
    queryFn: async () => {
      const [pos, grants, waiting] = await Promise.all([
        supabase.rpc('sg_my_position'),
        supabase.from('safeguarding_access_grants').select('id, expires_at, revoked_at').eq('profile_id', profile?.id ?? ''),
        supabase.rpc('sg_waiting_without_officer'),
      ]);
      if (pos.error) throw pos.error;
      const active = ((grants.data ?? []) as { expires_at: string; revoked_at: string | null }[]).some((g) => !g.revoked_at && new Date(g.expires_at) > new Date());
      return { position: (pos.data as MyPosition | null) ?? null, exceptional: active, waiting: Number(waiting.data ?? 0) };
    },
  });
  const position = me.data?.position ?? null;

  return (
    <section className="grid max-w-5xl gap-6">
      <h1 className="text-2xl font-bold text-purple-700">Safeguarding</h1>
      <p className="rounded-card border border-amber-300 bg-amber-50 p-3 text-sm">
        <strong>Confidential.</strong> Safeguarding records can be read only by the designated Safeguarding Lead and Deputy. Until one of them is appointed,
        Super Administrators hold this access instead; it ends automatically with the appointment. Other executives and staff cannot read records
        unless a different person grants time-limited, logged access. Record facts only. Records cannot be deleted. This screen does not replace the Foundation&apos;s
        safeguarding policy or any legal duty to report. DIRA LEARN is for people aged 18 to 25.
      </p>
      {me.isLoading && <p role="status">Checking your access…</p>}
      {isExecutive && (me.data?.waiting ?? 0) > 0 && (
        <p role="alert" className="rounded-card border border-danger bg-red-50 p-3 text-sm"><strong>{me.data?.waiting} safeguarding concern(s) are waiting and no Safeguarding Lead or Deputy is appointed.</strong> Appoint them below so the concerns can be handled. You cannot see what the concerns are.</p>
      )}
      {canRaiseConcern(profile?.role) && <RaiseConcern />}
      <Officers isExecutive={isExecutive} myId={profile?.id ?? ''} />
      {position === 'interim' && (
        <p role="note" className="rounded-card border border-orange-500 bg-orange-50 p-3 text-sm">
          <strong>Interim safeguarding access.</strong> No Safeguarding Lead or Deputy is appointed, so as Super Administrator you can see and handle
          safeguarding records, see open concerns on your dashboard, and receive urgent and overdue safeguarding alerts. This access ends automatically as soon as a Lead or Deputy is appointed below.
          Learners cannot start a conversation with the safeguarding team until then.
        </p>
      )}
      {position && <Records position={position} />}
      {(position || isExecutive) && <ExceptionalAccess myId={profile?.id ?? ''} />}
      {me.data?.exceptional && !position && <ExceptionalReader />}
      {(position || isExecutive) && <AccessLog />}
    </section>
  );
}

function RaiseConcern() {
  const [pid, setPid] = useState(''); const [summary, setSummary] = useState(''); const [urgency, setUrgency] = useState<'urgent' | 'standard'>('standard');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const participants = useQuery({
    queryKey: ['sg-participants'],
    queryFn: async () => { const { data, error } = await supabase.from('participants').select('id, participant_no, profiles(first_name, last_name)').order('participant_no'); if (error) throw error; return (data ?? []) as unknown as { id: string; participant_no: string; profiles: { first_name: string; last_name: string } | null }[]; },
  });
  const raise = useMutation({
    mutationFn: async () => {
      const bad = validateConcern(summary); if (bad) throw new Error(bad);
      const { error } = await supabase.rpc('sg_raise_concern', { p_participant: pid || null, p_summary: summary.trim(), p_urgency: urgency });
      if (error) throw error;
    },
    onSuccess: () => { setSummary(''); setPid(''); setUrgency('standard'); setMsg({ ok: true, text: 'Thank you. The concern was passed to the safeguarding officers. For confidentiality you will not see it again here.' }); },
    onError: (e) => setMsg({ ok: false, text: errText(e) }),
  });
  return (
    <form className="grid gap-3 rounded-card border border-purple-100 p-4" onSubmit={(e) => { e.preventDefault(); setMsg(null); raise.mutate(); }}>
      <h2 className="font-display text-lg font-semibold">Raise a safeguarding concern</h2>
      <p className="text-sm text-ink/70">If someone is in immediate danger, contact the emergency services first.</p>
      <label className="grid gap-1 text-sm font-medium">Learner <span className="font-normal text-ink/60">(optional)</span>
        <select value={pid} onChange={(e) => setPid(e.target.value)} className={field}><option value="">Not about one learner</option>{(participants.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.participant_no} {fullName(p.profiles)}</option>)}</select>
      </label>
      <fieldset className="grid gap-1 text-sm"><legend className="font-medium">How urgent is it?</legend>
        <label className="flex items-center gap-2"><input type="radio" checked={urgency === 'urgent'} onChange={() => setUrgency('urgent')} /> Urgent: someone may be at risk now (both officers are alerted at once)</label>
        <label className="flex items-center gap-2"><input type="radio" checked={urgency === 'standard'} onChange={() => setUrgency('standard')} /> Standard: acknowledged within 24 hours</label>
      </fieldset>
      <label className="grid gap-1 text-sm font-medium">What happened? Facts only: who, what, when, where.<textarea rows={4} value={summary} maxLength={2000} onChange={(e) => setSummary(e.target.value)} className={field} /></label>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? '' : 'text-danger'}`}>{msg.text}</p>}
      <Button type="submit" disabled={raise.isPending} className="justify-self-start">Send to safeguarding</Button>
    </form>
  );
}

function Officers({ isExecutive, myId }: { isExecutive: boolean; myId: string }) {
  const qc = useQueryClient();
  const { tz } = useProgrammeTimezone();
  const [error, setError] = useState<string | null>(null);
  const [pos, setPos] = useState<Position>('lead'); const [who, setWho] = useState(''); const [reason, setReason] = useState('');
  const [until, setUntil] = useState(''); const [note, setNote] = useState('');
  const officers = useQuery({
    queryKey: ['sg-officers'],
    queryFn: async () => { const { data, error: e } = await supabase.rpc('sg_officers'); if (e) throw e; return (data ?? []) as Officer[]; },
  });
  const people = useQuery({
    queryKey: ['sg-eligible'], enabled: isExecutive,
    queryFn: async () => { const { data, error: e } = await supabase.from('profiles').select('id, first_name, last_name, role').in('role', [...OFFICER_ELIGIBLE_ROLES]).eq('status', 'active').order('last_name'); if (e) throw e; return (data ?? []) as Person[]; },
  });
  const refresh = () => { setError(null); void qc.invalidateQueries({ queryKey: ['sg-officers'] }); void qc.invalidateQueries({ queryKey: ['sg-me'] }); };
  const appoint = useMutation({
    mutationFn: async () => {
      if (!who) throw new Error('Choose a person.');
      const bad = validateAppointmentReason(reason); if (bad) throw new Error(bad);
      const { error: e } = await supabase.rpc('sg_appoint', { p_position: pos, p_profile: who, p_reason: reason.trim() }); if (e) throw e;
    },
    onSuccess: () => { setWho(''); setReason(''); refresh(); }, onError: (e) => setError(errText(e)),
  });
  const remove = useMutation({
    mutationFn: async (p: Position) => {
      const r = window.prompt(`Why is the ${POSITION_LABEL[p]} being removed? (at least 10 characters, recorded)`) ?? '';
      const bad = validateAppointmentReason(r); if (bad) throw new Error(bad);
      const { error: e } = await supabase.rpc('sg_remove_officer', { p_position: p, p_reason: r.trim() }); if (e) throw e;
    },
    onSuccess: refresh, onError: (e) => setError(errText(e)),
  });
  const availability = useMutation({
    mutationFn: async (back: boolean) => {
      const { error: e } = await supabase.rpc('sg_set_unavailable', { p_until: back ? null : new Date(until).toISOString(), p_note: note.trim() || null }); if (e) throw e;
    },
    onSuccess: () => { setUntil(''); setNote(''); refresh(); }, onError: (e) => setError(errText(e)),
  });
  const list = officers.data ?? [];
  const lead = list.find((o) => o.officer_position === 'lead');
  const canSetAvailability = Boolean(lead) && (isExecutive || lead?.profile_id === myId);

  return (
    <section aria-labelledby="sg-officers" className="grid gap-3 rounded-card border border-purple-100 p-4">
      <h2 id="sg-officers" className="font-display text-lg font-semibold">Safeguarding officers</h2>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {officers.data && list.length === 0 && <p className="text-sm">No Safeguarding Lead or Deputy has been appointed yet. DIRA Foundation must designate them formally.</p>}
      <ul className="grid gap-2 text-sm">
        {list.map((o) => (
          <li key={o.officer_position} className="flex flex-wrap items-center justify-between gap-2">
            <span><strong>{POSITION_LABEL[o.officer_position]}:</strong> {o.display_name}{o.acting ? ' · acting now' : ''}{o.unavailable_until ? ` · unavailable until ${formatInZone(o.unavailable_until, tz)}` : ''}</span>
            {isExecutive && <Button variant="quiet" disabled={remove.isPending} onClick={() => remove.mutate(o.officer_position)}>Remove</Button>}
          </li>
        ))}
      </ul>
      {canSetAvailability && (
        <div className="grid gap-2 rounded-card bg-purple-50 p-3 text-sm sm:grid-cols-3">
          <p className="sm:col-span-3 font-medium">Lead availability (the Deputy acts while the Lead is unavailable)</p>
          <label className="grid gap-1">Unavailable until<input type="datetime-local" className={field} value={until} onChange={(e) => setUntil(e.target.value)} /></label>
          <label className="grid gap-1">Note (optional)<input className={field} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="flex items-end gap-2">
            <Button disabled={availability.isPending || !until} onClick={() => availability.mutate(false)}>Mark unavailable</Button>
            {lead?.unavailable_until && <Button variant="quiet" disabled={availability.isPending} onClick={() => availability.mutate(true)}>Mark available</Button>}
          </div>
        </div>
      )}
      {isExecutive && (
        <form className="grid gap-2 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); appoint.mutate(); }}>
          <p className="sm:col-span-3 text-sm text-ink/70">Appoint a Lead or Deputy. You cannot appoint yourself: another executive must do that. The person is notified.</p>
          <label className="grid gap-1 text-sm font-medium">Position<select className={field} value={pos} onChange={(e) => setPos(e.target.value as Position)}><option value="lead">Safeguarding Lead</option><option value="deputy">Safeguarding Deputy</option></select></label>
          <label className="grid gap-1 text-sm font-medium">Person<select className={field} value={who} onChange={(e) => setWho(e.target.value)}><option value="">Choose</option>{(people.data ?? []).filter((p) => p.id !== myId).map((p) => <option key={p.id} value={p.id}>{fullName(p)} · {p.role.replace(/_/g, ' ')}</option>)}</select></label>
          <label className="grid gap-1 text-sm font-medium">Reason (for example the board decision)<input className={field} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
          <div className="sm:col-span-3"><Button type="submit" disabled={appoint.isPending}>Appoint</Button></div>
        </form>
      )}
    </section>
  );
}

function Records({ position }: { position: MyPosition }) {
  const qc = useQueryClient();
  const { tz } = useProgrammeTimezone();
  const [filter, setFilter] = useState<'active' | 'all'>('active');
  const [openId, setOpenId] = useState<string | null>(null);
  const records = useQuery({
    queryKey: ['sg-records'],
    queryFn: async () => {
      const { data, error } = await supabase.from('safeguarding_records').select('*, participants(participant_no, profiles(first_name, last_name))').order('created_at', { ascending: false }).limit(500);
      if (error) throw error; return (data ?? []) as unknown as Row[];
    },
    refetchInterval: 60_000,
  });
  const rows = sortForOfficer((records.data ?? []).filter((r) => filter === 'all' || !['resolved', 'closed'].includes(r.status)));
  return (
    <section aria-labelledby="sg-records" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="sg-records" className="font-display text-lg font-semibold">Safeguarding records <span className="text-sm font-normal text-ink/60">(you have {myPositionText(position)})</span></h2>
        <label className="flex items-center gap-2 text-sm">Show<select className={field} value={filter} onChange={(e) => setFilter(e.target.value as 'active' | 'all')}><option value="active">Not yet resolved</option><option value="all">All</option></select></label>
      </div>
      {records.isLoading && <p role="status">Loading…</p>}
      {records.isError && <p role="alert" className="text-danger">Could not load records.</p>}
      {records.data && rows.length === 0 && <EmptyState title="No records">Nothing needs attention.</EmptyState>}
      <ul className="grid gap-3">
        {rows.map((r) => {
          const ack = ackState(r);
          return (
            <li key={r.id} className={`grid gap-2 rounded-card border p-4 text-sm ${ack.state === 'overdue' ? 'border-danger' : r.urgency === 'urgent' && ack.state === 'due' ? 'border-orange-500' : 'border-purple-100'}`}>
              <button type="button" className="grid gap-1 text-left" onClick={() => setOpenId(openId === r.id ? null : r.id)} aria-expanded={openId === r.id}>
                <span className="font-semibold">{URGENCY_LABEL[r.urgency]} · {SG_STATUS_LABEL[r.status as SgStatus] ?? r.status}{r.legal_hold ? ' · Legal hold' : ''}</span>
                <span className="text-xs text-ink/60">{formatInZone(r.created_at, tz)} · {SOURCE_LABEL[r.source] ?? r.source}{r.participants ? ` · ${r.participants.participant_no} ${fullName(r.participants.profiles)}` : ''}</span>
                <span className={`text-xs ${ack.state === 'overdue' ? 'font-semibold text-danger' : ''}`}>{ackText(ack)}</span>
              </button>
              {openId === r.id && <RecordDetail record={r} onChanged={() => void qc.invalidateQueries({ queryKey: ['sg-records'] })} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RecordDetail({ record, onChanged }: { record: Row; onChanged: () => void }) {
  const qc = useQueryClient();
  const { tz } = useProgrammeTimezone();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<SgStatus>((SG_NEXT_STATUSES as readonly string[]).includes(record.status) ? record.status as SgStatus : 'acknowledged');
  const [resolution, setResolution] = useState(record.resolution ?? '');
  const [note, setNote] = useState(''); const [noteKind, setNoteKind] = useState<'note' | 'referral'>('note');
  const [holdReason, setHoldReason] = useState(record.legal_hold_reason ?? '');
  const [readReason, setReadReason] = useState(''); const [readout, setReadout] = useState<{ id: string; sender_name: string; body: string; created_at: string; hidden: boolean }[] | null>(null);
  const officers = useQuery({ queryKey: ['sg-officers'], queryFn: async () => { const { data, error: e } = await supabase.rpc('sg_officers'); if (e) throw e; return (data ?? []) as Officer[]; } });
  const actions = useQuery({
    queryKey: ['sg-actions', record.id],
    queryFn: async () => { const { data, error: e } = await supabase.from('safeguarding_actions').select('*').eq('record_id', record.id).order('created_at'); if (e) throw e; return (data ?? []) as Action[]; },
  });
  const nameOf = (id: string | null) => officers.data?.find((o) => o.profile_id === id)?.display_name ?? (id ? 'Someone' : 'System');
  const done = () => { setError(null); onChanged(); void qc.invalidateQueries({ queryKey: ['sg-actions', record.id] }); };
  const update = useMutation({
    mutationFn: async (patch: Partial<SafeguardingRecord>) => { const { error: e } = await supabase.from('safeguarding_records').update(patch).eq('id', record.id); if (e) throw e; },
    onSuccess: done, onError: (e) => setError(errText(e)),
  });
  const addNote = useMutation({
    mutationFn: async () => {
      if (note.trim().length < 5) throw new Error('Write the note first.');
      const { error: e } = await supabase.from('safeguarding_actions').insert({ record_id: record.id, action: noteKind, note: note.trim() }); if (e) throw e;
    },
    onSuccess: () => { setNote(''); done(); }, onError: (e) => setError(errText(e)),
  });
  const read = useMutation({
    mutationFn: async () => {
      const bad = validateReadReason(readReason); if (bad) throw new Error(bad);
      const { data, error: e } = await supabase.rpc('connect_oversight_read', { p_conversation: record.conversation_id, p_reason: readReason.trim(), p_safeguarding_record: record.id });
      if (e) throw e; return (data ?? []) as { id: string; sender_name: string; body: string; created_at: string; hidden: boolean }[];
    },
    onSuccess: (d) => { setReadout(d); done(); }, onError: (e) => setError(errText(e)),
  });

  return (
    <div className="grid gap-3 border-t border-purple-100 pt-3">
      {error && <p role="alert" className="text-danger">{error}</p>}
      <p className="whitespace-pre-wrap">{record.summary}</p>
      {record.reported_message && <blockquote className="rounded-control bg-gray-100 p-2 text-xs"><strong>Reported message (copy):</strong><br /><span className="whitespace-pre-wrap">{record.reported_message}</span></blockquote>}
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="grid gap-1 font-medium">Status<select className={field} value={status} onChange={(e) => setStatus(e.target.value as SgStatus)}>{SG_NEXT_STATUSES.map((s) => <option key={s} value={s}>{SG_STATUS_LABEL[s]}</option>)}</select></label>
        <label className="grid gap-1 font-medium">Responsible officer
          <select className={field} value={record.responsible_officer ?? ''} onChange={(e) => update.mutate({ responsible_officer: e.target.value || null })}>
            <option value="">Not assigned</option>{(officers.data ?? []).map((o) => <option key={o.profile_id} value={o.profile_id}>{o.display_name} ({POSITION_LABEL[o.officer_position]})</option>)}
          </select>
        </label>
        <label className="grid gap-1 font-medium sm:col-span-3">Resolution / outcome<textarea className={field} rows={2} maxLength={2000} value={resolution} onChange={(e) => setResolution(e.target.value)} /></label>
        <div className="sm:col-span-3"><Button disabled={update.isPending} onClick={() => update.mutate({ status, resolution: resolution.trim() || null })}>Save status and outcome</Button></div>
      </div>
      <div className="grid gap-2 rounded-card bg-purple-50 p-3">
        <p className="font-medium">Legal hold {record.legal_hold ? '(on)' : '(off)'}: protects this learner&apos;s DIRA Connect messages from deletion</p>
        <input className={field} placeholder="Reason, for example a police or court reference" value={holdReason} maxLength={300} onChange={(e) => setHoldReason(e.target.value)} />
        <Button variant="quiet" disabled={update.isPending} onClick={() => update.mutate(record.legal_hold ? { legal_hold: false } : { legal_hold: true, legal_hold_reason: holdReason.trim() })}>{record.legal_hold ? 'Release legal hold' : 'Place legal hold'}</Button>
      </div>
      <div className="grid gap-2">
        <p className="font-medium">History</p>
        <ul className="grid gap-1 text-xs">{(actions.data ?? []).map((a) => <li key={a.id}><strong>{formatInZone(a.created_at, tz)}</strong> · {a.action.replace(/_/g, ' ')}{a.to_status ? ` → ${a.to_status.replace(/_/g, ' ')}` : ''} · {nameOf(a.actor_id)}{a.note ? `: ${a.note}` : ''}</li>)}</ul>
        <div className="flex flex-wrap gap-2">
          <select className={field} value={noteKind} onChange={(e) => setNoteKind(e.target.value as 'note' | 'referral')}><option value="note">Action or note</option><option value="referral">Referral made</option></select>
          <input className={`${field} flex-1`} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="What was done, by whom, when" />
          <Button disabled={addNote.isPending} onClick={() => addNote.mutate()}>Add</Button>
        </div>
      </div>
      {record.conversation_id && (
        <div className="grid gap-2 rounded-card border border-orange-500 p-3">
          <p className="font-medium">Linked DIRA Connect conversation</p>
          <p className="text-xs">Opening it is logged with your name, the time and your reason, and added to this record&apos;s history. Only the acting Safeguarding Lead can open a conversation that was not reported.</p>
          <input className={field} value={readReason} maxLength={300} onChange={(e) => setReadReason(e.target.value)} placeholder="Reason (at least 10 characters)" />
          <Button variant="quiet" disabled={read.isPending} onClick={() => read.mutate()}>Open conversation (logged)</Button>
          {readout && <ul className="grid gap-1 text-xs">{[...readout].reverse().map((m) => <li key={m.id}><strong>{m.sender_name}</strong> · {formatInZone(m.created_at, tz)}{m.hidden ? ' · hidden from members' : ''}<br /><span className="whitespace-pre-wrap">{m.body}</span></li>)}</ul>}
        </div>
      )}
    </div>
  );
}

function ExceptionalAccess({ myId }: { myId: string }) {
  const qc = useQueryClient();
  const { tz } = useProgrammeTimezone();
  const [error, setError] = useState<string | null>(null);
  const [who, setWho] = useState(''); const [days, setDays] = useState(3); const [reason, setReason] = useState('');
  const data = useQuery({
    queryKey: ['sg-grants'],
    queryFn: async () => {
      const [g, p] = await Promise.all([
        supabase.from('safeguarding_access_grants').select('*').order('granted_at', { ascending: false }).limit(50),
        supabase.from('profiles').select('id, first_name, last_name, role').in('role', [...OFFICER_ELIGIBLE_ROLES]).eq('status', 'active').order('last_name'),
      ]);
      if (g.error) throw g.error; if (p.error) throw p.error;
      return { grants: (g.data ?? []) as Grant[], people: (p.data ?? []) as Person[] };
    },
  });
  const name = (id: string) => fullName(data.data?.people.find((p) => p.id === id)) || 'Someone';
  const grant = useMutation({
    mutationFn: async () => {
      if (!who) throw new Error('Choose a person.');
      const bad = validateExceptionalReason(reason); if (bad) throw new Error(bad);
      const { error: e } = await supabase.rpc('sg_grant_exceptional_access', { p_profile: who, p_days: days, p_reason: reason.trim() }); if (e) throw e;
    },
    onSuccess: () => { setWho(''); setReason(''); setError(null); void qc.invalidateQueries({ queryKey: ['sg-grants'] }); }, onError: (e) => setError(errText(e)),
  });
  const revoke = useMutation({
    mutationFn: async (id: string) => { const { error: e } = await supabase.rpc('sg_revoke_exceptional_access', { p_grant: id }); if (e) throw e; },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['sg-grants'] }), onError: (e) => setError(errText(e)),
  });
  return (
    <section aria-labelledby="sg-exceptional" className="grid gap-3 rounded-card border border-purple-100 p-4 text-sm">
      <h2 id="sg-exceptional" className="font-display text-lg font-semibold">Exceptional access</h2>
      <p className="text-ink/70">Only when there is a justified need (for example a board investigation). Granted by a safeguarding officer or by a different executive, never to yourself, for 1 to 7 days. Each record opened needs its own reason, is logged, and the acting officer is told.</p>
      {error && <p role="alert" className="text-danger">{error}</p>}
      <form className="grid gap-2 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); grant.mutate(); }}>
        <label className="grid gap-1 font-medium">Person<select className={field} value={who} onChange={(e) => setWho(e.target.value)}><option value="">Choose</option>{(data.data?.people ?? []).filter((p) => p.id !== myId).map((p) => <option key={p.id} value={p.id}>{fullName(p)} · {p.role.replace(/_/g, ' ')}</option>)}</select></label>
        <label className="grid gap-1 font-medium">Days<select className={field} value={days} onChange={(e) => setDays(Number(e.target.value))}>{[1, 2, 3, 5, 7].map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
        <label className="grid gap-1 font-medium">Reason (at least 20 characters)<input className={field} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} /></label>
        <div className="sm:col-span-3"><Button type="submit" disabled={grant.isPending}>Grant exceptional access</Button></div>
      </form>
      <ul className="grid gap-1 text-xs">
        {(data.data?.grants ?? []).map((g) => {
          const active = !g.revoked_at && new Date(g.expires_at) > new Date();
          return <li key={g.id} className="flex flex-wrap items-center justify-between gap-2"><span><strong>{name(g.profile_id)}</strong> · granted by {name(g.granted_by)} · until {formatInZone(g.expires_at, tz)} · {active ? 'active' : g.revoked_at ? 'revoked' : 'expired'} · {g.reason}</span>{active && <Button variant="quiet" onClick={() => revoke.mutate(g.id)}>Revoke</Button>}</li>;
        })}
      </ul>
    </section>
  );
}

function ExceptionalReader() {
  const { tz } = useProgrammeTimezone();
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState(''); const [reason, setReason] = useState('');
  const index = useQuery({
    queryKey: ['sg-exc-index'],
    queryFn: async () => { const { data, error: e } = await supabase.rpc('sg_exceptional_index'); if (e) throw e; return (data ?? []) as { id: string; created_at: string; urgency: 'urgent' | 'standard'; status: string }[]; },
  });
  const read = useMutation({
    mutationFn: async () => {
      if (!pick) throw new Error('Choose a record.');
      const bad = validateReadReason(reason); if (bad) throw new Error(bad);
      const { data, error: e } = await supabase.rpc('sg_exceptional_read', { p_record: pick, p_reason: reason.trim() }); if (e) throw e;
      return ((data ?? []) as { summary: string; reported_message: string | null; resolution: string | null; status: string; history: { action: string; at: string; note: string | null }[] }[])[0] ?? null;
    },
    onError: (e) => setError(errText(e)), onSuccess: () => setError(null),
  });
  return (
    <section aria-labelledby="sg-reader" className="grid gap-3 rounded-card border border-orange-500 p-4 text-sm">
      <h2 id="sg-reader" className="font-display text-lg font-semibold">Read a record under exceptional access</h2>
      {error && <p role="alert" className="text-danger">{error}</p>}
      <select className={field} value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Choose a record</option>{(index.data ?? []).map((r) => <option key={r.id} value={r.id}>{formatInZone(r.created_at, tz)} · {URGENCY_LABEL[r.urgency]} · {r.status.replace(/_/g, ' ')}</option>)}</select>
      <input className={field} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Reason for opening this record (logged)" />
      <Button disabled={read.isPending} onClick={() => read.mutate()} className="justify-self-start">Open record (logged)</Button>
      {read.data && (
        <div className="grid gap-2">
          <p className="whitespace-pre-wrap">{read.data.summary}</p>
          {read.data.reported_message && <blockquote className="rounded-control bg-gray-100 p-2 text-xs">{read.data.reported_message}</blockquote>}
          {read.data.resolution && <p><strong>Outcome:</strong> {read.data.resolution}</p>}
          <ul className="text-xs">{read.data.history.map((h, i) => <li key={i}>{formatInZone(h.at, tz)} · {h.action.replace(/_/g, ' ')}{h.note ? `: ${h.note}` : ''}</li>)}</ul>
        </div>
      )}
    </section>
  );
}

function AccessLog() {
  const { tz } = useProgrammeTimezone();
  const log = useQuery({
    queryKey: ['sg-access-log'],
    queryFn: async () => { const { data, error } = await supabase.from('safeguarding_access_log').select('*').order('created_at', { ascending: false }).limit(50); if (error) throw error; return (data ?? []) as LogRow[]; },
  });
  const officers = useQuery({ queryKey: ['sg-officers'], queryFn: async () => { const { data, error } = await supabase.rpc('sg_officers'); if (error) throw error; return (data ?? []) as Officer[]; } });
  const name = (id: string) => officers.data?.find((o) => o.profile_id === id)?.display_name ?? 'A staff member';
  return (
    <section aria-labelledby="sg-log" className="grid gap-2 rounded-card border border-purple-100 p-4 text-sm">
      <h2 id="sg-log" className="font-display text-lg font-semibold">Access log</h2>
      <p className="text-xs text-ink/60">Every exceptional read of a record and every safeguarding read of a private conversation. No content is shown here.</p>
      {(log.data ?? []).length === 0 && <p className="text-ink/70">Nothing has been accessed.</p>}
      <ul className="grid gap-1 text-xs">{(log.data ?? []).map((l) => <li key={l.id}><strong>{formatInZone(l.created_at, tz)}</strong> · {name(l.profile_id)} · {l.basis.replace(/_/g, ' ')} · {l.reason}</li>)}</ul>
    </section>
  );
}
