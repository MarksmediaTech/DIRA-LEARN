import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { AlumniRecord } from '@/types/database';

interface Row extends AlumniRecord { participants: { participant_no: string; profiles: { first_name: string; last_name: string } | null } | null }
const FIELDS = [
  ['employment_status', 'Employment'], ['further_education', 'Further education or training'], ['enterprise_activity', 'Business or enterprise activity'], ['achievements', 'Achievements since the programme'],
] as const;
type Field = (typeof FIELDS)[number][0];
const COLS = 'id, participant_id, employment_status, further_education, enterprise_activity, achievements, updated_at';

export function AlumniPage() {
  const { profile } = useAuth();
  return profile?.role === 'participant' ? <MyRecord /> : <AlumniList />;
}

function MyRecord() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['my-alumni'],
    queryFn: async () => { const { data, error } = await supabase.from('alumni').select(COLS).maybeSingle(); if (error) throw error; return data as AlumniRecord | null; },
  });
  const [form, setForm] = useState<Record<Field, string>>({ employment_status: '', further_education: '', enterprise_activity: '', achievements: '' });
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (q.data) setForm({ employment_status: q.data.employment_status ?? '', further_education: q.data.further_education ?? '', enterprise_activity: q.data.enterprise_activity ?? '', achievements: q.data.achievements ?? '' }); }, [q.data]);
  const save = useMutation({
    mutationFn: async () => {
      const body = Object.fromEntries(FIELDS.map(([k]) => [k, form[k].trim() || null]));
      const { error } = await supabase.from('alumni').update(body).eq('id', q.data!.id);
      if (error) throw error;
    },
    onSuccess: () => { setMsg('Saved.'); void qc.invalidateQueries({ queryKey: ['my-alumni'] }); },
    onError: (e: Error) => setMsg(e.message),
  });
  if (q.isLoading) return <p role="status">Loading…</p>;
  if (q.isError) return <p role="alert" className="text-danger">Could not load your alumni record.</p>;
  if (!q.data) return <EmptyState title="Not an alumnus yet">After you graduate, the programme team moves you into the alumni list and you can share how you are getting on here.</EmptyState>;
  return (
    <section className="grid max-w-2xl gap-4">
      <h1 className="text-2xl font-bold text-purple-700">My alumni update</h1>
      <p className="text-sm text-ink/70">Tell us what you are doing now. The programme team and the M&amp;E officer can read this, and it helps us report on what the programme achieves. Share only what you are comfortable with.</p>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); setMsg(null); save.mutate(); }}>
        {FIELDS.map(([k, label]) => (
          <label key={k} className="grid gap-1 text-sm font-medium">{label}
            <textarea rows={2} maxLength={500} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="rounded-control border border-purple-200 px-3 py-2 font-normal" />
          </label>
        ))}
        {msg && <p role="status" className="text-sm">{msg}</p>}
        <Button type="submit" disabled={save.isPending} className="justify-self-start">Save update</Button>
        <p className="text-xs text-ink/60">Last updated {q.data.updated_at.slice(0, 10)}</p>
      </form>
    </section>
  );
}

function AlumniList() {
  const [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: ['alumni-list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('alumni').select(`${COLS}, participants(participant_no, profiles(first_name, last_name))`).order('updated_at', { ascending: false });
      if (error) throw error;
      return data as unknown as Row[];
    },
  });
  if (q.isLoading) return <p role="status">Loading…</p>;
  if (q.isError) return <p role="alert" className="text-danger">Could not load alumni.</p>;
  const term = search.trim().toLowerCase();
  const rows = (q.data ?? []).filter((r) => !term || `${r.participants?.profiles?.first_name ?? ''} ${r.participants?.profiles?.last_name ?? ''} ${r.participants?.participant_no ?? ''}`.toLowerCase().includes(term));
  return (
    <section className="grid max-w-5xl gap-4">
      <h1 className="text-2xl font-bold text-purple-700">Alumni</h1>
      <p className="text-sm text-ink/70">Graduates are moved here from Certificates (Move to alumni). They update their own follow-up information.</p>
      <label className="grid max-w-xs gap-1 text-sm font-medium">Search by name or number
        <input value={search} onChange={(e) => setSearch(e.target.value)} className="rounded-control border border-purple-200 px-3 py-2 font-normal" />
      </label>
      {!rows.length ? <EmptyState title="No alumni to show">{q.data?.length ? 'No one matches that search.' : 'Nobody has been moved to the alumni list yet.'}</EmptyState> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm"><caption className="sr-only">Alumni follow-up</caption>
            <thead><tr className="border-b border-purple-200"><th scope="col" className="p-2">Alumnus</th>{FIELDS.map(([k, l]) => <th key={k} scope="col" className="p-2">{l}</th>)}<th scope="col" className="p-2">Updated</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="border-b border-purple-100 align-top">
                <th scope="row" className="p-2 font-medium">{`${r.participants?.profiles?.first_name ?? ''} ${r.participants?.profiles?.last_name ?? ''}`.trim() || 'Unnamed'}<div className="text-xs font-normal text-ink/60">{r.participants?.participant_no}</div></th>
                {FIELDS.map(([k]) => <td key={k} className="p-2">{r[k] ?? <span className="text-ink/50">Not shared</span>}</td>)}
                <td className="p-2">{r.updated_at.slice(0, 10)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
