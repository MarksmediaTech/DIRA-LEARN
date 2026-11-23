import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { describeFunctionError } from '@/lib/functionError';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { OUTCOME_LABEL, checkSingleLearner, parseLearnerCsv, sampleCsv, validRows, type ImportRow, type RowOutcome, type TrackOption } from './rules';

interface Result { batchId: string | null; invited: number; alreadyRegistered: number; failed: number; rows: { rowNo: number; email: string; outcome: RowOutcome; message: string | null }[] }
interface Batch { id: string; file_name: string | null; total: number; invited: number; already_registered: number; failed: number; created_at: string }

const field = 'rounded-control border border-purple-200 px-3 py-2 font-normal';

/**
 * Add one learner from the dashboard (22 Nov 2026). Same pathway as a CSV row: the same Edge Function (import-learners) checks the
 * role and the values again, sends the invitation and records the programme track; the learner becomes an active participant
 * when they set their first password, with no cohort. Recorded in the import history as "Added on the dashboard".
 */
function AddLearnerForm({ tracks, onDone }: { tracks: readonly TrackOption[]; onDone: () => void }) {
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [trackId, setTrackId] = useState('');
  const [problem, setProblem] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: async (l: { name: string; email: string; track: TrackOption }) => {
      const { data, error: e } = await supabase.functions.invoke('import-learners', { body: { fileName: 'Added on the dashboard', rows: [{ name: l.name, email: l.email, programme_track: l.track.name }] } });
      if (e) {
        const info = await describeFunctionError(e);
        throw new Error(info.kind === 'unreachable'
          ? `${info.message} It is not known whether the invitation was sent: check "Earlier imports" below before adding this learner again.`
          : `The learner was not added: ${info.message}`);
      }
      const row = (data as Partial<Result> | null)?.rows?.[0];
      if (!row || typeof row.outcome !== 'string') throw new Error('The server gave an unexpected answer, so the result is unknown. Check "Earlier imports" below before adding again.');
      return { row, learner: l };
    },
    onSuccess: ({ row, learner }) => {
      onDone();
      if (row.outcome === 'invited') {
        setNotice(`${row.message ? row.message + ': i' : 'I'}nvitation sent to ${learner.email} (${learner.track.name}). ${learner.name} becomes an active participant when they set their password; assign a cohort afterwards.`);
        setName(''); setEmail(''); setTrackId('');
      } else if (row.outcome === 'already_registered') setProblem(`${learner.email} already has an account, so nothing was changed and the learner was not enrolled. Check the Users page.`);
      else setProblem(`The learner was not added: ${row.message ?? 'the invitation could not be sent'}.`);
    },
    onError: (e: Error) => { setProblem(e.message); onDone(); },
  });
  const submit = (ev: FormEvent) => {
    ev.preventDefault(); setProblem(null); setNotice(null);
    const c = checkSingleLearner({ name, email, trackId }, tracks);
    if (!c.ok) { setProblem(c.error); return; }
    if (!window.confirm(`Send an invitation to ${c.name} (${c.email}), track ${c.track.name}?\nThey become an active participant when they set their password.`)) return;
    add.mutate({ name: c.name, email: c.email, track: c.track });
  };
  return (
    <form onSubmit={submit} noValidate className="grid gap-3 rounded-card border border-purple-100 p-4">
      <h2 className="font-display text-lg font-semibold">Add one learner</h2>
      <p className="text-sm text-ink/70">All fields are required. Existing accounts are never changed; a learner who was invited before but has not set a password yet gets the invitation again.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1 text-sm font-medium">Name <span aria-hidden className="text-danger">*</span><input required aria-required="true" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" className={field} /></label>
        <label className="grid gap-1 text-sm font-medium">Email <span aria-hidden className="text-danger">*</span><input required aria-required="true" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" className={field} /></label>
        <label className="grid gap-1 text-sm font-medium"><span>Programme track <span aria-hidden className="text-danger">*</span></span>
          <select required aria-required="true" value={trackId} onChange={(e) => setTrackId(e.target.value)} className={field}>
            <option value="">Choose…</option>
            {tracks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      </div>
      {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
      {notice && <p role="status" className="text-sm text-ok">{notice}</p>}
      <Button type="submit" disabled={add.isPending || !tracks.length} className="justify-self-start">{add.isPending ? 'Sending…' : 'Add learner and send invitation'}</Button>
    </form>
  );
}

export function ImportPage() {
  const qc = useQueryClient();
  const [fileName, setFileName] = useState(''); const [text, setText] = useState<string | null>(null); const [fileError, setFileError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null); const [error, setError] = useState<string | null>(null);

  // The programme tracks configured in DIRA LEARN: every row's programme_track must be one of them (checked again by the server).
  const tracks = useQuery({
    queryKey: ['tracks', 'import'],
    queryFn: async () => { const { data, error: e } = await supabase.from('tracks').select('id, name, position').order('position'); if (e) throw e; return (data ?? []) as (TrackOption & { position: number })[]; },
  });
  const parsed = useMemo(() => (text === null || !tracks.data ? null : parseLearnerCsv(text, tracks.data)), [text, tracks.data]);
  const rows: ImportRow[] = parsed?.rows ?? [];
  const shownFileError = fileError ?? parsed?.fileError ?? null;

  const history = useQuery({
    queryKey: ['import-batches'],
    queryFn: async () => { const { data, error: e } = await supabase.from('import_batches').select('id, file_name, total, invited, already_registered, failed, created_at').order('created_at', { ascending: false }).limit(20); if (e) throw e; return data as Batch[]; },
  });

  const onFile = async (f: File | undefined) => {
    setResult(null); setError(null); setText(null); setFileError(null);
    if (!f) return;
    setFileName(f.name);
    if (!/\.csv$/i.test(f.name)) { setFileError('Please choose a .csv file. In Excel use Save As, then CSV.'); return; }
    if (f.size > 1_000_000) { setFileError('The file is too large for an import.'); return; }
    setText(await f.text());
  };

  const send = useMutation({
    mutationFn: async () => {
      const ok = validRows(rows);
      const { data, error: e } = await supabase.functions.invoke('import-learners', { body: { fileName, rows: ok.map((r) => ({ name: r.name, email: r.email, programme_track: r.trackName })) } });
      if (e) {
        // Every Supabase function error type is handled (a network error has no response to read: that caused "j.json is not a function").
        const info = await describeFunctionError(e);
        throw new Error(info.kind === 'unreachable'
          ? `${info.message} It is not known whether any invitation was sent: check "Earlier imports" below before importing this file again.`
          : `The import did not run: ${info.message}`);
      }
      const d = data as Partial<Result> | null;
      if (!d || !Array.isArray(d.rows) || typeof d.invited !== 'number') throw new Error('The server gave an unexpected answer, so the result is unknown. Check "Earlier imports" below before importing again.');
      return d as Result;
    },
    onSuccess: (d) => { setResult(d); setText(null); void qc.invalidateQueries({ queryKey: ['import-batches'] }); },
    onError: (e: Error) => { setError(e.message); void qc.invalidateQueries({ queryKey: ['import-batches'] }); },
  });

  const good = validRows(rows);
  const download = () => {
    const url = URL.createObjectURL(new Blob([sampleCsv(tracks.data ?? [])], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'learners-template.csv'; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <section className="grid max-w-4xl gap-5">
      <h1 className="text-2xl font-bold text-purple-700">Add learners</h1>
      <p className="text-sm text-ink/80">Add learners one at a time below, or many at once from a CSV file. Either way each learner receives an email invitation and becomes an <strong>active participant</strong> when they set their password, with their programme track saved and <strong>no cohort</strong>. There is no application form or approval for learners added here; public applicants keep the normal application process.</p>
      {tracks.data && <AddLearnerForm tracks={tracks.data} onDone={() => void qc.invalidateQueries({ queryKey: ['import-batches'] })} />}
      <h2 className="font-display text-lg font-semibold">Import from a CSV file</h2>
      <div className="rounded-card border border-purple-100 p-4 text-sm">
        <p>Upload a CSV file with exactly the columns <strong>name, email, programme_track</strong> (up to 200 learners). Invalid rows are shown and skipped.</p>
        <p className="mt-2">Programme tracks{tracks.data ? <>: <strong>{tracks.data.map((t) => t.name).join(', ')}</strong></> : ''}. Write them exactly like this (capital letters do not matter).</p>
        <p className="mt-2 text-ink/70">Invitation emails are sent by Supabase Auth. Set up Auth SMTP first (see docs/LEARNER_ONBOARDING.md); the built-in sender only allows a few emails per hour. Only import people who expect to hear from DIRA Foundation.</p>
        <Button type="button" variant="quiet" className="mt-2" onClick={download}>Download a template</Button>
      </div>
      <label className="grid max-w-md gap-1 text-sm font-medium">CSV file
        <input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
      </label>
      {tracks.isError && <p role="alert" className="text-sm text-danger">Could not load the programme tracks, so files cannot be checked. Reload the page.</p>}
      {text !== null && tracks.isLoading && <p role="status" className="text-sm">Checking the file against the programme tracks…</p>}
      {shownFileError && <p role="alert" className="text-sm text-danger">{shownFileError}</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      {rows.length > 0 && (
        <div className="grid gap-3">
          <p className="text-sm"><strong>{good.length}</strong> of {rows.length} rows are ready{rows.length - good.length > 0 && <>; <strong className="text-danger">{rows.length - good.length}</strong> need fixing in the file and will be skipped</>}.</p>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-left text-sm"><caption className="sr-only">Preview of the file</caption>
              <thead><tr className="border-b border-purple-200"><th scope="col" className="p-2">Row</th><th scope="col" className="p-2">Name</th><th scope="col" className="p-2">Email</th><th scope="col" className="p-2">Programme track</th><th scope="col" className="p-2">Check</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.rowNo} className="border-b border-purple-100"><td className="p-2">{r.rowNo}</td><td className="p-2">{r.name}</td><td className="p-2">{r.email}</td><td className="p-2">{r.trackName ?? r.programmeTrack}</td>
                  <td className={`p-2 ${r.error ? 'text-danger' : 'text-ok'}`}>{r.error ?? 'Ready'}</td></tr>))}</tbody>
            </table>
          </div>
          <Button type="button" disabled={!good.length || send.isPending} className="justify-self-start" onClick={() => { if (window.confirm(`Send ${good.length} invitation emails now?`)) send.mutate(); }}>{send.isPending ? 'Sending…' : `Send ${good.length} invitations`}</Button>
        </div>
      )}

      {result && (
        <div className="grid gap-2" role="status">
          <p className="text-sm"><strong>{result.invited}</strong> invitations sent, <strong>{result.alreadyRegistered}</strong> already had an account (not enrolled: check them on the Users page), <strong>{result.failed}</strong> failed.</p>
          {result.rows.some((r) => r.outcome !== 'invited' || r.message) && (
            <ul className="text-sm">{result.rows.filter((r) => r.outcome !== 'invited' || r.message).map((r) => <li key={r.rowNo}>Row {r.rowNo}, {r.email}: {OUTCOME_LABEL[r.outcome]}{r.message ? ` (${r.message})` : ''}</li>)}</ul>
          )}
        </div>
      )}

      <div className="grid gap-2">
        <h2 className="font-display text-lg font-semibold">Earlier imports</h2>
        {history.isLoading && <p role="status">Loading…</p>}
        {history.isError && <p role="alert" className="text-danger">Could not load earlier imports.</p>}
        {history.data && !history.data.length && <EmptyState title="No imports yet">Imports you run appear here.</EmptyState>}
        {!!history.data?.length && (
          <table className="w-full text-left text-sm"><caption className="sr-only">Earlier imports</caption>
            <thead><tr className="border-b border-purple-200"><th scope="col" className="p-2">When</th><th scope="col" className="p-2">File</th><th scope="col" className="p-2">Invited</th><th scope="col" className="p-2">Already registered</th><th scope="col" className="p-2">Failed</th></tr></thead>
            <tbody>{history.data.map((b) => <tr key={b.id} className="border-b border-purple-100"><td className="p-2">{new Date(b.created_at).toLocaleString()}</td><td className="p-2">{b.file_name ?? ''}</td><td className="p-2">{b.invited}</td><td className="p-2">{b.already_registered}</td><td className="p-2">{b.failed}</td></tr>)}</tbody>
          </table>
        )}
      </div>
    </section>
  );
}
