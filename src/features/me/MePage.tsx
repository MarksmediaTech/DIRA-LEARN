import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { DataQuality, MeIndicator, MeRecord } from '@/types/database';
import { achievementPercent, latestByIndicator, toCsv, validateRecord } from './rules';

interface Funnel { status: string; total: number }
interface Capacity { cohort_id: string; name: string; capacity: number; enrolled: number }
interface TrackCount { cohort_id: string; track_name: string; participants: number }
interface AttRow { participant_id: string; counted: number; attended: number; rate_percent: number | null }
const input = 'rounded-control border border-purple-200 px-3 py-2 font-normal';

export function MePage() {
  const { profile } = useAuth();
  const canEdit = profile?.role === 'me_officer';
  const qc = useQueryClient();
  const refresh = () => void qc.invalidateQueries({ queryKey: ['me'] });

  const live = useQuery({
    queryKey: ['me', 'live'],
    queryFn: async () => {
      const [f, c, t, a] = await Promise.all([
        supabase.from('v_application_funnel').select('status, total'),
        supabase.from('v_cohort_capacity').select('cohort_id, name, capacity, enrolled'),
        supabase.from('v_track_enrolment').select('cohort_id, track_name, participants'),
        supabase.from('v_attendance_by_participant').select('participant_id, counted, attended, rate_percent'),
      ]);
      for (const r of [f, c, t, a]) if (r.error) throw r.error;
      return { funnel: f.data as Funnel[], capacity: c.data as Capacity[], tracks: t.data as TrackCount[], attendance: a.data as AttRow[] };
    },
  });
  const indicators = useQuery({
    queryKey: ['me', 'indicators'],
    queryFn: async () => { const { data, error } = await supabase.from('me_indicators').select('id, programme_id, name, definition, unit, target, is_active').order('name'); if (error) throw error; return data as MeIndicator[]; },
  });
  const records = useQuery({
    queryKey: ['me', 'records'],
    queryFn: async () => { const { data, error } = await supabase.from('me_records').select('id, indicator_id, cohort_id, value, data_quality, recorded_on, note').order('recorded_on', { ascending: false }); if (error) throw error; return data as MeRecord[]; },
  });
  const cohorts = useQuery({
    queryKey: ['me', 'cohorts'],
    queryFn: async () => { const { data, error } = await supabase.from('cohorts').select('id, name, programme_id').order('start_date', { ascending: false }); if (error) throw error; return data as { id: string; name: string; programme_id: string }[]; },
  });
  const programme = useQuery({
    queryKey: ['me', 'programme'],
    queryFn: async () => { const { data, error } = await supabase.from('programmes').select('id, name').order('version', { ascending: false }).limit(1).maybeSingle(); if (error) throw error; return data as { id: string; name: string } | null; },
  });

  // ---- new indicator ----
  const [iName, setIName] = useState(''); const [iDef, setIDef] = useState(''); const [iUnit, setIUnit] = useState(''); const [iTarget, setITarget] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const addIndicator = useMutation({
    mutationFn: async () => {
      if (!iName.trim()) throw new Error('Give the indicator a name.');
      if (iTarget.trim() && !Number.isFinite(Number(iTarget))) throw new Error('The target must be a number, or left empty if none has been agreed.');
      const { error } = await supabase.from('me_indicators').insert({ programme_id: programme.data?.id ?? null, name: iName.trim(), definition: iDef.trim() || null, unit: iUnit.trim() || null, target: iTarget.trim() ? Number(iTarget) : null, created_by: profile?.id });
      if (error) throw error;
    },
    onSuccess: () => { setIName(''); setIDef(''); setIUnit(''); setITarget(''); setMsg(null); refresh(); },
    onError: (e: Error) => setMsg(e.message),
  });

  // ---- new record ----
  const [rInd, setRInd] = useState(''); const [rCohort, setRCohort] = useState(''); const [rQuality, setRQuality] = useState<DataQuality>('measured');
  const [rValue, setRValue] = useState(''); const [rDate, setRDate] = useState(new Date().toISOString().slice(0, 10)); const [rNote, setRNote] = useState('');
  const [recMsg, setRecMsg] = useState<string | null>(null);
  const addRecord = useMutation({
    mutationFn: async () => {
      if (!rInd) throw new Error('Choose an indicator.');
      const v = validateRecord({ quality: rQuality, value: rValue });
      if (v.error) throw new Error(v.error);
      const { error } = await supabase.from('me_records').insert({ indicator_id: rInd, cohort_id: rCohort || null, value: v.value, data_quality: rQuality, recorded_on: rDate, note: rNote.trim() || null });
      if (error) throw error;
    },
    onSuccess: () => { setRValue(''); setRNote(''); setRecMsg(null); refresh(); },
    onError: (e: Error) => setRecMsg(e.message),
  });

  const latest = useMemo(() => latestByIndicator(records.data ?? []), [records.data]);
  const attendanceAvg = useMemo(() => {
    const rows = (live.data?.attendance ?? []).filter((r) => r.rate_percent !== null);
    return rows.length ? Math.round((rows.reduce((s, r) => s + (r.rate_percent ?? 0), 0) / rows.length) * 10) / 10 : null;
  }, [live.data]);

  const exportCsv = () => {
    const indById = new Map((indicators.data ?? []).map((i) => [i.id, i]));
    const cohortById = new Map((cohorts.data ?? []).map((c) => [c.id, c.name]));
    const csv = toCsv(['Indicator', 'Unit', 'Target', 'Cohort', 'Recorded on', 'Value', 'Data quality', 'Note'],
      (records.data ?? []).map((r) => { const i = indById.get(r.indicator_id); return [i?.name ?? '', i?.unit ?? '', i?.target ?? null, r.cohort_id ? cohortById.get(r.cohort_id) ?? '' : 'All cohorts', r.recorded_on, r.value, r.data_quality, r.note]; }));
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `dira-learn-me-records-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  };

  if (live.isLoading || indicators.isLoading) return <p role="status">Loading…</p>;
  if (live.isError || indicators.isError) return <p role="alert" className="text-danger">Could not load M&amp;E data.</p>;

  return (
    <section className="grid max-w-5xl gap-6">
      <h1 className="text-2xl font-bold text-purple-700">Monitoring and evaluation</h1>

      <div>
        <h2 className="mb-2 font-display text-lg font-semibold">Live programme figures</h2>
        <p className="mb-3 text-sm text-ink/70">Calculated from the records in the system right now. Nothing here is typed in by hand.</p>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Enrolled participants" value={String(live.data?.capacity.reduce((s, c) => s + c.enrolled, 0) ?? 0)} />
          <Stat label="Cohorts" value={String(live.data?.capacity.length ?? 0)} />
          <Stat label="Average attendance rate" value={attendanceAvg === null ? '–' : `${attendanceAvg}%`} hint="Late counts as attended; excused is left out (draft rule)" />
          {canEdit
            ? <Stat label="Applications received" value="–" hint="Application records are not visible to the M&E role" />
            : <Stat label="Applications received" value={String(live.data?.funnel.reduce((s, f) => s + f.total, 0) ?? 0)} />}
        </dl>
        {!!live.data?.capacity.length && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm"><caption className="sr-only">Cohort capacity and track choices</caption>
              <thead><tr className="border-b border-purple-200"><th scope="col" className="p-2">Cohort</th><th scope="col" className="p-2">Enrolled</th><th scope="col" className="p-2">Track choices</th></tr></thead>
              <tbody>{live.data.capacity.map((c) => (
                <tr key={c.cohort_id} className="border-b border-purple-100 align-top">
                  <th scope="row" className="p-2 font-medium">{c.name}</th><td className="p-2">{c.enrolled} of {c.capacity}</td>
                  <td className="p-2">{live.data!.tracks.filter((t) => t.cohort_id === c.cohort_id).map((t) => `${t.track_name}: ${t.participants}`).join(' · ') || 'No track chosen yet'}</td>
                </tr>))}</tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-lg font-semibold">Indicators</h2>
          <Button variant="quiet" type="button" onClick={exportCsv} disabled={!records.data?.length}>Export records (CSV)</Button>
        </div>
        <p className="text-sm text-ink/70">Indicators and targets are entered by the M&amp;E officer. None are pre-filled: no targets have been supplied to the system.</p>
        {!indicators.data?.length ? <EmptyState title="No indicators yet">{canEdit ? 'Add the first indicator below.' : 'The M&E officer adds indicators here.'}</EmptyState> : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm"><caption className="sr-only">Indicators with latest value and target</caption>
              <thead><tr className="border-b border-purple-200"><th scope="col" className="p-2">Indicator</th><th scope="col" className="p-2">Latest value</th><th scope="col" className="p-2">Target</th><th scope="col" className="p-2">Of target</th><th scope="col" className="p-2">Quality</th></tr></thead>
              <tbody>{indicators.data.map((i) => {
                const r = latest.get(i.id);
                const pct = achievementPercent(r?.value ?? null, i.target);
                return (
                  <tr key={i.id} className="border-b border-purple-100 align-top">
                    <th scope="row" className="p-2 font-medium">{i.name}{i.definition && <div className="text-xs font-normal text-ink/60">{i.definition}</div>}</th>
                    <td className="p-2">{r ? (r.value === null ? 'Missing' : `${r.value}${i.unit ? ` ${i.unit}` : ''}`) : 'No record'}{r && <div className="text-xs text-ink/60">{r.recorded_on}</div>}</td>
                    <td className="p-2">{i.target === null ? 'No target set' : `${i.target}${i.unit ? ` ${i.unit}` : ''}`}</td>
                    <td className="p-2">{pct === null ? '–' : `${pct}%`}</td>
                    <td className="p-2 capitalize">{r?.data_quality ?? '–'}</td>
                  </tr>);
              })}</tbody>
            </table>
          </div>
        )}
      </div>

      {canEdit && (
        <div className="grid gap-5 md:grid-cols-2">
          <form className="grid gap-3 rounded-card border border-purple-100 p-4" onSubmit={(e) => { e.preventDefault(); addIndicator.mutate(); }}>
            <h2 className="font-display text-lg font-semibold">Add an indicator</h2>
            <label className="grid gap-1 text-sm font-medium">Name<input value={iName} onChange={(e) => setIName(e.target.value)} className={input} /></label>
            <label className="grid gap-1 text-sm font-medium">Definition <span className="font-normal text-ink/60">(how it is measured)</span><textarea rows={2} value={iDef} onChange={(e) => setIDef(e.target.value)} className={input} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-sm font-medium">Unit<input value={iUnit} onChange={(e) => setIUnit(e.target.value)} placeholder="e.g. %, people" className={input} /></label>
              <label className="grid gap-1 text-sm font-medium">Target <span className="font-normal text-ink/60">(optional)</span><input inputMode="decimal" value={iTarget} onChange={(e) => setITarget(e.target.value)} className={input} /></label>
            </div>
            {msg && <p role="alert" className="text-sm text-danger">{msg}</p>}
            <Button type="submit" disabled={addIndicator.isPending} className="justify-self-start">Add indicator</Button>
          </form>
          <form className="grid gap-3 rounded-card border border-purple-100 p-4" onSubmit={(e) => { e.preventDefault(); addRecord.mutate(); }}>
            <h2 className="font-display text-lg font-semibold">Record a value</h2>
            <label className="grid gap-1 text-sm font-medium">Indicator
              <select value={rInd} onChange={(e) => setRInd(e.target.value)} className={input}><option value="">Choose</option>{(indicators.data ?? []).filter((i) => i.is_active).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
            </label>
            <label className="grid gap-1 text-sm font-medium">Cohort <span className="font-normal text-ink/60">(optional)</span>
              <select value={rCohort} onChange={(e) => setRCohort(e.target.value)} className={input}><option value="">All cohorts</option>{(cohorts.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-sm font-medium">Data quality
                <select value={rQuality} onChange={(e) => { setRQuality(e.target.value as DataQuality); if (e.target.value === 'missing') setRValue(''); }} className={input}>
                  <option value="measured">Measured</option><option value="estimated">Estimated</option><option value="missing">Missing</option>
                </select>
              </label>
              <label className="grid gap-1 text-sm font-medium">Value<input inputMode="decimal" value={rValue} disabled={rQuality === 'missing'} onChange={(e) => setRValue(e.target.value)} className={input} /></label>
            </div>
            <label className="grid gap-1 text-sm font-medium">Date<input type="date" value={rDate} onChange={(e) => setRDate(e.target.value)} className={input} /></label>
            <label className="grid gap-1 text-sm font-medium">Note <span className="font-normal text-ink/60">(optional)</span><input value={rNote} onChange={(e) => setRNote(e.target.value)} className={input} /></label>
            {recMsg && <p role="alert" className="text-sm text-danger">{recMsg}</p>}
            <Button type="submit" disabled={addRecord.isPending} className="justify-self-start">Save record</Button>
          </form>
        </div>
      )}
      {!canEdit && <p className="text-xs text-ink/60">Only the M&amp;E officer can add indicators and records. You can read and export them.</p>}
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-card border border-purple-100 p-4">
      <dt className="text-sm text-ink/70">{label}</dt><dd className="font-display text-2xl font-bold">{value}</dd>
      {hint && <p className="mt-1 text-xs text-ink/60">{hint}</p>}
    </div>
  );
}
