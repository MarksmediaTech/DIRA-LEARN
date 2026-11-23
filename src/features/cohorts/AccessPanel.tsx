import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import type { Cohort } from '@/types/database';
import { useAuth } from '@/features/auth/AuthProvider';
import { EXECUTIVE_ROLES } from '@/lib/permissions';
import { formatInZone, listTimeZones } from '@/lib/timezone';
import { ACCESS_LABEL, canManageAccess, isoToLocalInput, optionalLocalToIso, validateAccessWindow, type AccessStatus } from './accessRules';
import { useProgrammeTimezone } from './useProgrammeTimezone';

// Staff view of learning access for one cohort. All decisions are made and enforced in the database (migration 18);
// this screen only edits the cohort's window and each learner's override, always with a written reason.

interface RosterRow { participant_id: string; participant_no: string; learner_name: string; status: AccessStatus; opens_at: string | null; closes_at: string | null; has_override: boolean }
interface HistoryRow { created_at: string; cohort_name: string; action: string; opens_at: string | null; closes_at: string | null; reason: string; actor_name: string | null }

const input = 'rounded-control border border-purple-200 px-3 py-2 font-normal';
const BADGE: Record<AccessStatus, string> = {
  active: 'bg-green-100 text-green-900', scheduled: 'bg-purple-100 text-purple-900', pending: 'bg-gray-100 text-gray-800',
  expired: 'bg-orange-100 text-orange-900', suspended: 'bg-red-100 text-red-900',
};

export function AccessPanel({ cohort }: { cohort: Cohort }) {
  const { profile } = useAuth();
  const { tz, programmeId } = useProgrammeTimezone();
  const canManage = canManageAccess(profile?.role);
  const canSetZone = !!profile && EXECUTIVE_ROLES.includes(profile.role);
  return (
    <section aria-labelledby="access-heading" className="grid gap-5">
      <h2 id="access-heading" className="text-xl font-semibold">Learning access</h2>
      <p className="text-sm text-ink/70">All times are in the programme time zone: <strong>{tz}</strong>.</p>
      {canSetZone && programmeId && <ZonePicker programmeId={programmeId} tz={tz} />}
      {!canManage && <p className="rounded-card border border-purple-100 p-3 text-sm">You can see who has access. Only a super administrator, Founder, Co-Founder or programme director can change access times, extend or suspend a learner.</p>}
      <CohortWindow cohort={cohort} tz={tz} canManage={canManage} />
      <AccessRoster cohort={cohort} tz={tz} canManage={canManage} />
    </section>
  );
}

function ZonePicker({ programmeId, tz }: { programmeId: string; tz: string }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(tz);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = useMutation({
    mutationFn: async () => { const { error } = await supabase.from('programmes').update({ timezone: value }).eq('id', programmeId); if (error) throw error; },
    onSuccess: () => { setMsg({ ok: true, text: 'Programme time zone saved. Stored times do not move; only how they are entered and shown.' }); void qc.invalidateQueries({ queryKey: ['programme-timezone'] }); },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-card border border-purple-100 p-3">
      <label className="grid gap-1 text-sm font-medium">Programme time zone
        <select className={input} value={value} onChange={(e) => setValue(e.target.value)}>{listTimeZones().map((z) => <option key={z} value={z}>{z}</option>)}</select>
      </label>
      <Button disabled={save.isPending || value === tz} onClick={() => { setMsg(null); save.mutate(); }}>Save time zone</Button>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? '' : 'text-danger'}`}>{msg.text}</p>}
    </div>
  );
}

function CohortWindow({ cohort, tz, canManage }: { cohort: Cohort; tz: string; canManage: boolean }) {
  const qc = useQueryClient();
  const [intake, setIntake] = useState(cohort.intake_label ?? '');
  const [season, setSeason] = useState(cohort.season ?? '');
  const [recOpen, setRecOpen] = useState(cohort.recruitment_opens_on ?? '');
  const [recClose, setRecClose] = useState(cohort.recruitment_closes_on ?? '');
  const [opens, setOpens] = useState(isoToLocalInput(cohort.access_opens_at, tz));
  const [closes, setCloses] = useState(isoToLocalInput(cohort.access_closes_at, tz));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const bad = validateAccessWindow(opens, closes) ?? (recOpen && recClose && recClose < recOpen ? 'Recruitment cannot close before it opens.' : null);
      if (bad) throw new Error(bad);
      const { error } = await supabase.from('cohorts').update({
        intake_label: intake.trim() || null, season: season.trim() || null,
        recruitment_opens_on: recOpen || null, recruitment_closes_on: recClose || null,
        // Only managers may change the access times (the database refuses anyone else), so others never send them.
        ...(canManage ? { access_opens_at: optionalLocalToIso(opens, tz), access_closes_at: optionalLocalToIso(closes, tz) } : {}),
      }).eq('id', cohort.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setMsg({ ok: true, text: 'Cohort access settings saved.' });
      void qc.invalidateQueries({ queryKey: ['cohort', cohort.id] });
      void qc.invalidateQueries({ queryKey: ['cohorts'] });
      void qc.invalidateQueries({ queryKey: ['cohort-access', cohort.id] });
    },
    onError: (e: Error) => setMsg({ ok: false, text: e.message }),
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); setMsg(null); save.mutate(); }} className="grid gap-3 rounded-card border border-purple-100 p-4 sm:grid-cols-2">
      <label className="grid gap-1 text-sm font-medium">Intake name<input className={input} value={intake} onChange={(e) => setIntake(e.target.value)} maxLength={80} /></label>
      <label className="grid gap-1 text-sm font-medium">Programme season<input className={input} value={season} onChange={(e) => setSeason(e.target.value)} maxLength={80} /></label>
      <label className="grid gap-1 text-sm font-medium">Recruitment opens<input type="date" className={input} value={recOpen} onChange={(e) => setRecOpen(e.target.value)} /></label>
      <label className="grid gap-1 text-sm font-medium">Recruitment closes<input type="date" className={input} value={recClose} onChange={(e) => setRecClose(e.target.value)} /></label>
      <label className="grid gap-1 text-sm font-medium">Learning portal opens<input type="datetime-local" className={input} value={opens} disabled={!canManage} onChange={(e) => setOpens(e.target.value)} /></label>
      <label className="grid gap-1 text-sm font-medium">Learning portal closes<input type="datetime-local" className={input} value={closes} disabled={!canManage} onChange={(e) => setCloses(e.target.value)} /></label>
      <p className="text-xs text-ink/70 sm:col-span-2">Programme start and end dates stay as set above. Without an opening time, enrolled learners have no access. Without a closing time, access stays open. Times are in the programme time zone and checked against the server clock.</p>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={save.isPending}>Save access settings</Button>
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={`text-sm ${msg.ok ? '' : 'text-danger'}`}>{msg.text}</p>}
      </div>
    </form>
  );
}

function AccessRoster({ cohort, tz, canManage }: { cohort: Cohort; tz: string; canManage: boolean }) {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [opens, setOpens] = useState('');
  const [closes, setCloses] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const roster = useQuery({
    queryKey: ['cohort-access', cohort.id],
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('cohort_access_roster', { p_cohort: cohort.id });
      if (e) throw e;
      return (data ?? []) as RosterRow[];
    },
  });
  const history = useQuery({
    queryKey: ['learner-access-history', historyId],
    enabled: historyId !== null,
    queryFn: async () => {
      const { data, error: e } = await supabase.rpc('learner_access_history', { p_participant: historyId });
      if (e) throw e;
      return (data ?? []) as HistoryRow[];
    },
  });

  const done = () => {
    setError(null); setOpenId(null); setReason('');
    void qc.invalidateQueries({ queryKey: ['cohort-access', cohort.id] });
    void qc.invalidateQueries({ queryKey: ['learner-access-history'] });
  };
  const needReason = () => (reason.trim().length < 5 ? 'Write a reason of at least 5 characters.' : null);

  const setOverride = useMutation({
    mutationFn: async (v: { participant: string; clear: boolean }) => {
      const bad = needReason() ?? (v.clear ? null : validateAccessWindow(opens, closes));
      if (bad) throw new Error(bad);
      if (!v.clear && !opens && !closes) throw new Error('Choose a new opening or closing time, or use Remove override.');
      const { error: e } = await supabase.rpc('set_learner_access_override', {
        p_participant: v.participant, p_cohort: cohort.id,
        p_opens_at: v.clear ? null : optionalLocalToIso(opens, tz), p_closes_at: v.clear ? null : optionalLocalToIso(closes, tz), p_reason: reason.trim(),
      });
      if (e) throw e;
    },
    onSuccess: done,
    onError: (e: Error) => setError(e.message),
  });
  const suspend = useMutation({
    mutationFn: async (v: { participant: string; suspended: boolean }) => {
      const bad = needReason();
      if (bad) throw new Error(bad);
      const { error: e } = await supabase.rpc('set_learner_suspension', { p_participant: v.participant, p_cohort: cohort.id, p_suspended: v.suspended, p_reason: reason.trim() });
      if (e) throw e;
    },
    onSuccess: done,
    onError: (e: Error) => setError(e.message),
  });

  if (roster.isLoading) return <p role="status">Loading learner access…</p>;
  if (roster.isError) return <p role="alert" className="text-danger">Could not load learner access.</p>;
  const rows = roster.data ?? [];
  if (rows.length === 0) return <p className="text-sm text-ink/70">No learners are enrolled in this cohort yet.</p>;
  const busy = setOverride.isPending || suspend.isPending;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">Learning access for each enrolled learner</caption>
        <thead><tr className="border-b border-purple-200"><th scope="col" className="p-2">Learner</th><th scope="col" className="p-2">Access</th><th scope="col" className="p-2">Opens</th><th scope="col" className="p-2">Closes</th><th scope="col" className="p-2"><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.participant_id} className="border-b border-purple-100 align-top">
              <th scope="row" className="p-2 font-medium">{r.learner_name || 'Unnamed'}<div className="text-xs font-normal text-ink/60">{r.participant_no}</div></th>
              <td className="p-2"><span className={`rounded-control px-2 py-0.5 text-xs font-semibold ${BADGE[r.status]}`}>{ACCESS_LABEL[r.status]}</span>{r.has_override && <div className="text-xs text-ink/60">Individual dates</div>}</td>
              <td className="p-2">{formatInZone(r.opens_at, tz)}</td>
              <td className="p-2">{formatInZone(r.closes_at, tz)}</td>
              <td className="p-2">
                <div className="flex flex-wrap gap-2">
                  {canManage && <Button variant="quiet" onClick={() => { setError(null); setReason(''); setOpens(isoToLocalInput(r.opens_at, tz)); setCloses(isoToLocalInput(r.closes_at, tz)); setOpenId(openId === r.participant_id ? null : r.participant_id); }}>Change access</Button>}
                  <Button variant="quiet" onClick={() => setHistoryId(historyId === r.participant_id ? null : r.participant_id)}>History</Button>
                </div>
                {canManage && openId === r.participant_id && (
                  <div className="mt-3 grid gap-2 rounded-card border border-purple-100 p-3">
                    <label className="grid gap-1 text-xs font-medium">Opens (this learner only)<input type="datetime-local" className={input} value={opens} onChange={(e) => setOpens(e.target.value)} /></label>
                    <label className="grid gap-1 text-xs font-medium">Closes (this learner only)<input type="datetime-local" className={input} value={closes} onChange={(e) => setCloses(e.target.value)} /></label>
                    <label className="grid gap-1 text-xs font-medium">Reason (required, kept in the history)<input className={input} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></label>
                    <div className="flex flex-wrap gap-2">
                      <Button disabled={busy} onClick={() => setOverride.mutate({ participant: r.participant_id, clear: false })}>Save dates</Button>
                      {r.has_override && <Button variant="quiet" disabled={busy} onClick={() => setOverride.mutate({ participant: r.participant_id, clear: true })}>Remove override</Button>}
                      <Button variant="accent" disabled={busy} onClick={() => suspend.mutate({ participant: r.participant_id, suspended: r.status !== 'suspended' })}>{r.status === 'suspended' ? 'Reinstate access' : 'Suspend access'}</Button>
                    </div>
                    {error && <p role="alert" className="text-xs text-danger">{error}</p>}
                  </div>
                )}
                {historyId === r.participant_id && (
                  <div className="mt-3 rounded-card border border-purple-100 p-3 text-xs">
                    {history.isLoading && <p role="status">Loading history…</p>}
                    {history.isError && <p role="alert" className="text-danger">Could not load history.</p>}
                    {history.data && history.data.length === 0 && <p>No access changes recorded.</p>}
                    <ul className="grid gap-2">{(history.data ?? []).map((h, i) => <li key={i}><strong>{new Date(h.created_at).toLocaleString()}</strong> · {h.cohort_name} · {h.action.replace('_', ' ')}{h.actor_name ? ` by ${h.actor_name}` : ''}<br />{h.reason}</li>)}</ul>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
