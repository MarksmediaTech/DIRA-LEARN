// FIXTURE: the Import learners page exactly as released on 21 Nov 2026, kept only to reproduce "j.json is not a function" (tools/recovery/browser/enrolment_flow.mjs). Not part of the app.
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { OUTCOME_LABEL, SAMPLE_CSV, parseLearnerCsv, validRows, type ImportRow, type RowOutcome } from './rules';

interface Result { batchId: string | null; invited: number; alreadyRegistered: number; failed: number; rows: { rowNo: number; email: string; outcome: RowOutcome; message: string | null }[] }
interface Batch { id: string; file_name: string | null; total: number; invited: number; already_registered: number; failed: number; created_at: string }

export function ImportPage() {
  const qc = useQueryClient();
  const [fileName, setFileName] = useState(''); const [rows, setRows] = useState<ImportRow[]>([]); const [fileError, setFileError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null); const [error, setError] = useState<string | null>(null);

  const history = useQuery({
    queryKey: ['import-batches'],
    queryFn: async () => { const { data, error: e } = await supabase.from('import_batches').select('id, file_name, total, invited, already_registered, failed, created_at').order('created_at', { ascending: false }).limit(20); if (e) throw e; return data as Batch[]; },
  });

  const onFile = async (f: File | undefined) => {
    setResult(null); setError(null); setRows([]); setFileError(null);
    if (!f) return;
    setFileName(f.name);
    if (!/\.csv$/i.test(f.name)) { setFileError('Please choose a .csv file. In Excel use Save As, then CSV.'); return; }
    if (f.size > 1_000_000) { setFileError('The file is too large for an import.'); return; }
    const parsed = parseLearnerCsv(await f.text());
    setFileError(parsed.fileError); setRows(parsed.rows);
  };

  const send = useMutation({
    mutationFn: async () => {
      const ok = validRows(rows);
      const { data, error: e } = await supabase.functions.invoke('import-learners', { body: { fileName, rows: ok.map((r) => ({ first_name: r.firstName, last_name: r.lastName, email: r.email })) } });
      if (e) { const ctx = (e as { context?: Response }).context; const detail = ctx ? await ctx.json().catch(() => null) : null; throw new Error(detail?.error ?? e.message); }
      return data as Result;
    },
    onSuccess: (d) => { setResult(d); setRows([]); void qc.invalidateQueries({ queryKey: ['import-batches'] }); },
    onError: (e: Error) => setError(e.message),
  });

  const good = validRows(rows);
  const download = () => {
    const url = URL.createObjectURL(new Blob([SAMPLE_CSV], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'learners-template.csv'; a.click(); URL.revokeObjectURL(url);
  };

  return (
    <section className="grid max-w-4xl gap-5">
      <h1 className="text-2xl font-bold text-purple-700">Import learners</h1>
      <div className="rounded-card border border-purple-100 p-4 text-sm">
        <p>Upload a CSV file with the columns <strong>first_name, last_name, email</strong> (up to 200 learners). Each learner receives an email invitation to set a password. They arrive as <strong>applicants</strong>: they still complete the application form and go through your normal review before becoming participants.</p>
        <p className="mt-2 text-ink/70">Invitation emails are sent by Supabase Auth. Set up Auth SMTP first (see docs/LEARNER_ONBOARDING.md); the built-in sender only allows a few emails per hour. Only import people who expect to hear from DIRA Foundation.</p>
        <Button type="button" variant="quiet" className="mt-2" onClick={download}>Download a template</Button>
      </div>
      <label className="grid max-w-md gap-1 text-sm font-medium">CSV file
        <input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
      </label>
      {fileError && <p role="alert" className="text-sm text-danger">{fileError}</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}

      {rows.length > 0 && (
        <div className="grid gap-3">
          <p className="text-sm"><strong>{good.length}</strong> of {rows.length} rows are ready{rows.length - good.length > 0 && <>; <strong className="text-danger">{rows.length - good.length}</strong> need fixing in the file and will be skipped</>}.</p>
          <div className="max-h-96 overflow-auto">
            <table className="w-full text-left text-sm"><caption className="sr-only">Preview of the file</caption>
              <thead><tr className="border-b border-purple-200"><th scope="col" className="p-2">Row</th><th scope="col" className="p-2">Name</th><th scope="col" className="p-2">Email</th><th scope="col" className="p-2">Check</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.rowNo} className="border-b border-purple-100"><td className="p-2">{r.rowNo}</td><td className="p-2">{r.firstName} {r.lastName}</td><td className="p-2">{r.email}</td>
                  <td className={`p-2 ${r.error ? 'text-danger' : 'text-ok'}`}>{r.error ?? 'Ready'}</td></tr>))}</tbody>
            </table>
          </div>
          <Button type="button" disabled={!good.length || send.isPending} className="justify-self-start" onClick={() => { if (window.confirm(`Send ${good.length} invitation emails now?`)) send.mutate(); }}>{send.isPending ? 'Sending…' : `Send ${good.length} invitations`}</Button>
        </div>
      )}

      {result && (
        <div className="grid gap-2" role="status">
          <p className="text-sm"><strong>{result.invited}</strong> invitations sent, <strong>{result.alreadyRegistered}</strong> already had an account, <strong>{result.failed}</strong> failed.</p>
          {result.rows.some((r) => r.outcome !== 'invited') && (
            <ul className="text-sm">{result.rows.filter((r) => r.outcome !== 'invited').map((r) => <li key={r.rowNo}>Row {r.rowNo}, {r.email}: {OUTCOME_LABEL[r.outcome]}{r.message ? ` (${r.message})` : ''}</li>)}</ul>
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
