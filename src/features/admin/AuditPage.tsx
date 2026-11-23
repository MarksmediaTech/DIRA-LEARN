import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ACTION_LABEL, changedFields } from './rules';

interface Row { id: number; actor_id: string | null; table_name: string; row_id: string | null; action: string; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null; created_at: string }
const PAGE = 50;

export function AuditPage() {
  const [table, setTable] = useState('');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<number | null>(null);

  const tables = useQuery({
    queryKey: ['audit-tables'],
    queryFn: async () => { const { data, error } = await supabase.from('audit_logs').select('table_name').order('created_at', { ascending: false }).limit(1000); if (error) throw error; return [...new Set((data as { table_name: string }[]).map((r) => r.table_name))].sort(); },
  });
  const q = useQuery({
    queryKey: ['audit', table, page],
    queryFn: async () => {
      let query = supabase.from('audit_logs').select('id, actor_id, table_name, row_id, action, old_data, new_data, created_at').order('id', { ascending: false }).range(page * PAGE, page * PAGE + PAGE);
      if (table) query = query.eq('table_name', table);
      const { data, error } = await query;
      if (error) throw error;
      const rows = data as Row[];
      const ids = [...new Set(rows.map((r) => r.actor_id).filter((x): x is string => Boolean(x)))];
      const names = new Map<string, string>();
      if (ids.length) {
        const p = await supabase.from('profiles').select('id, first_name, last_name, role').in('id', ids);
        for (const x of (p.data ?? []) as { id: string; first_name: string; last_name: string; role: string }[]) names.set(x.id, `${x.first_name} ${x.last_name}`.trim() || x.role);
      }
      return { rows, names };
    },
  });

  return (
    <section className="grid max-w-5xl gap-4">
      <h1 className="text-2xl font-bold text-purple-700">Audit log</h1>
      <p className="text-sm text-ink/70">A permanent record of who changed what. Entries cannot be edited or deleted. Safeguarding case details are deliberately not copied here.</p>
      <label className="grid max-w-xs gap-1 text-sm font-medium">Show changes to
        <select value={table} onChange={(e) => { setTable(e.target.value); setPage(0); setOpen(null); }} className="rounded-control border border-purple-200 px-3 py-2 font-normal">
          <option value="">Everything</option>{(tables.data ?? []).map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </select>
      </label>
      {q.isLoading && <p role="status">Loading…</p>}
      {q.isError && <p role="alert" className="text-danger">Could not load the audit log.</p>}
      {q.data && !q.data.rows.length && <EmptyState title="No entries">{page ? 'No more entries.' : 'Nothing has been recorded yet.'}</EmptyState>}
      {q.data && q.data.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm"><caption className="sr-only">Audit entries, newest first</caption>
            <thead><tr className="border-b border-purple-200"><th scope="col" className="p-2">When</th><th scope="col" className="p-2">Who</th><th scope="col" className="p-2">What</th><th scope="col" className="p-2">Details</th></tr></thead>
            <tbody>{q.data.rows.slice(0, PAGE).map((r) => {
              const fields = changedFields(r.old_data, r.new_data);
              return (
                <tr key={r.id} className="border-b border-purple-100 align-top">
                  <td className="p-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="p-2">{r.actor_id ? q.data!.names.get(r.actor_id) ?? 'Unknown account' : 'System'}</td>
                  <td className="p-2">{ACTION_LABEL[r.action] ?? r.action} {r.table_name.replace(/_/g, ' ')}</td>
                  <td className="p-2">
                    {fields.length > 0 && <span>{fields.join(', ')} </span>}
                    <button type="button" aria-expanded={open === r.id} className="text-purple-700 underline" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide' : 'Show'} record</button>
                    {open === r.id && <pre className="mt-2 max-w-md overflow-x-auto rounded-control bg-purple-50 p-2 text-xs">{JSON.stringify({ before: r.old_data, after: r.new_data }, null, 2)}</pre>}
                  </td>
                </tr>);
            })}</tbody>
          </table>
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="quiet" type="button" disabled={page === 0} onClick={() => { setPage(page - 1); setOpen(null); }}>Newer</Button>
        <Button variant="quiet" type="button" disabled={!q.data || q.data.rows.length <= PAGE} onClick={() => { setPage(page + 1); setOpen(null); }}>Older</Button>
      </div>
    </section>
  );
}
