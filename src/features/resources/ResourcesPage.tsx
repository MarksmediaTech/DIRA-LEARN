import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { FILE_NOT_AVAILABLE } from '@/lib/files';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { filterResources, groupResources, KIND_LABEL, safeExternalUrl, type Kind, type ResourceRow } from './rules';

const field = 'rounded-control border border-purple-200 px-3 py-2 font-normal';

export function ResourcesPage() {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind | ''>('');
  const [problem, setProblem] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ['my-resources'],
    queryFn: async () => {
      // Row-level security already limits this to resources shared with participants for the core or the participant's own track.
      const { data, error } = await supabase.from('learning_resources')
        .select('id, title, kind, storage_path, external_url, created_at, curriculum_sessions(week_no, session_no, title, track_id)');
      if (error) throw error;
      return data as unknown as ResourceRow[];
    },
  });

  const open = async (r: ResourceRow) => {
    setProblem(null);
    if (r.external_url) {
      const href = safeExternalUrl(r.external_url);
      if (!href) { setProblem('That link is not a valid web address, so it was not opened. Tell your trainer.'); return; }
      window.open(href, '_blank', 'noopener,noreferrer');
      return;
    }
    if (!r.storage_path) { setProblem('This resource has nothing to open.'); return; }
    const { data, error } = await supabase.storage.from('learning-resources').createSignedUrl(r.storage_path, 300);
    if (error || !data) { setProblem(FILE_NOT_AVAILABLE); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  if (q.isLoading) return <p role="status">Loading resources…</p>;
  if (q.isError) return <p role="alert" className="text-danger">Could not load resources.</p>;
  const all = q.data ?? [];
  if (!all.length) return <EmptyState title="No resources yet">Your trainers will share notes, slides and links here as sessions happen.</EmptyState>;
  const groups = groupResources(filterResources(all, { query, kind }));

  return (
    <section className="grid max-w-3xl gap-6">
      <h1 className="text-2xl font-bold text-purple-700">Resources</h1>
      <div className="flex flex-wrap gap-3">
        <label className="grid gap-1 text-sm font-medium">Search
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Title or session" className={`${field} w-64`} />
        </label>
        <label className="grid gap-1 text-sm font-medium">Type
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind | '')} className={field}>
            <option value="">All types</option>
            {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
        </label>
      </div>
      {problem && <p role="alert" className="text-sm text-danger">{problem}</p>}
      {!groups.length && <p className="text-sm text-ink/70">Nothing matches your search.</p>}
      {groups.map((g) => (
        <div key={g.key} className="grid gap-2">
          <h2 className="font-display text-lg font-semibold text-purple-900">{g.heading}</h2>
          <ul className="divide-y divide-purple-100 rounded-card border border-purple-100">
            {g.items.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <span>{r.title} <span className="text-xs text-ink/60">{KIND_LABEL[r.kind]}</span></span>
                <Button variant="quiet" onClick={() => void open(r)} aria-label={`Open ${r.title}`}>Open</Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
