import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { GraduationRule, SystemSetting } from '@/types/database';
import { formatSettingValue, parseSettingValue } from './rules';

const field = 'rounded-control border border-purple-200 px-3 py-2 font-normal';

export function SettingsPage() {
  return (
    <section className="grid max-w-4xl gap-8">
      <h1 className="text-2xl font-bold text-purple-700">Settings and approvals</h1>
      <p className="rounded-card border border-amber-300 bg-amber-50 p-3 text-sm">Items marked <strong>Draft</strong> are recommendations that management has not approved. Changing an approved item sends it back to draft until it is approved again.</p>
      <GraduationRules />
      <Settings />
    </section>
  );
}

function GraduationRules() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const programme = useQuery({
    queryKey: ['settings-programme'],
    queryFn: async () => { const { data, error: e } = await supabase.from('programmes').select('id, name').order('version', { ascending: false }).limit(1).maybeSingle(); if (e) throw e; return data as { id: string; name: string } | null; },
  });
  const rule = useQuery({
    queryKey: ['graduation-rule', programme.data?.id], enabled: Boolean(programme.data),
    queryFn: async () => { const { data, error: e } = await supabase.from('graduation_rules').select('id, programme_id, min_sessions_attended, require_core_sessions, require_final_project, require_reflection, is_approved, approved_at').eq('programme_id', programme.data!.id).maybeSingle(); if (e) throw e; return data as GraduationRule | null; },
  });
  const [min, setMin] = useState<string | null>(null);
  const [flags, setFlags] = useState<{ core: boolean; final: boolean; reflection: boolean } | null>(null);
  const r = rule.data;
  const minValue = min ?? (r?.min_sessions_attended?.toString() ?? '');
  const f = flags ?? { core: r?.require_core_sessions ?? true, final: r?.require_final_project ?? true, reflection: r?.require_reflection ?? true };
  const refresh = () => { setMin(null); setFlags(null); setError(null); void qc.invalidateQueries({ queryKey: ['graduation-rule'] }); };

  const save = useMutation({
    mutationFn: async () => {
      const n = minValue.trim() === '' ? null : Number(minValue);
      if (n !== null && (!Number.isInteger(n) || n < 1 || n > 8)) throw new Error('Minimum sessions must be a whole number from 1 to 8, or empty for no minimum.');
      const body = { min_sessions_attended: n, require_core_sessions: f.core, require_final_project: f.final, require_reflection: f.reflection };
      const res = r ? await supabase.from('graduation_rules').update(body).eq('id', r.id) : await supabase.from('graduation_rules').insert({ ...body, programme_id: programme.data!.id });
      if (res.error) throw res.error;
    },
    onSuccess: refresh, onError: (e: Error) => setError(e.message),
  });
  const approve = useMutation({
    mutationFn: async (approved: boolean) => { const { error: e } = await supabase.from('graduation_rules').update({ is_approved: approved }).eq('id', r!.id); if (e) throw e; },
    onSuccess: refresh, onError: (e: Error) => setError(e.message),
  });

  if (programme.isLoading || rule.isLoading) return <p role="status">Loading…</p>;
  if (programme.isError || rule.isError) return <p role="alert" className="text-danger">Could not load graduation rules.</p>;
  if (!programme.data) return <EmptyState title="No programme found">Graduation rules belong to a programme.</EmptyState>;
  const dirty = min !== null || flags !== null;
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold">Graduation and certificate rules: {programme.data.name}</h2>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${r?.is_approved ? 'bg-green-100 text-ok' : 'bg-amber-100 text-warn'}`}>{r ? (r.is_approved ? 'Approved' : 'Draft') : 'Not set up'}</span>
      </div>
      <p className="text-sm text-ink/70">A certificate can only be issued while these rules are approved. The curriculum document suggests 6 of 8 sessions including both core sessions, but that is a recommendation: nothing is pre-filled here. A pass mark on overall results is not supported until assessment weights are approved.</p>
      <form className="grid gap-3 rounded-card border border-purple-100 p-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <label className="grid max-w-xs gap-1 text-sm font-medium">Minimum sessions attended <span className="font-normal text-ink/60">(1 to 8, empty for none)</span>
          <input inputMode="numeric" value={minValue} onChange={(e) => setMin(e.target.value)} className={field} />
        </label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.core} onChange={(e) => setFlags({ ...f, core: e.target.checked })} /> Must have attended all core sessions</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.final} onChange={(e) => setFlags({ ...f, final: e.target.checked })} /> Must have submitted the final project</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.reflection} onChange={(e) => setFlags({ ...f, reflection: e.target.checked })} /> Must have submitted the reflection and 30-day plan</label>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={save.isPending || (!!r && !dirty)}>{r ? 'Save changes' : 'Create rules (draft)'}</Button>
          {r && !r.is_approved && <Button variant="accent" type="button" disabled={approve.isPending || dirty} onClick={() => { if (window.confirm('Approve these graduation rules on behalf of management? Certificates can then be issued.')) approve.mutate(true); }}>Approve rules</Button>}
          {r?.is_approved && <Button variant="quiet" type="button" disabled={approve.isPending} onClick={() => approve.mutate(false)}>Withdraw approval</Button>}
        </div>
        {dirty && r && !r.is_approved && <p className="text-xs text-ink/60">Save your changes before approving.</p>}
        {r?.is_approved && r.approved_at && <p className="text-xs text-ink/60">Approved on {r.approved_at.slice(0, 10)}.</p>}
      </form>
    </div>
  );
}

function Settings() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['system-settings'],
    queryFn: async () => { const { data, error: e } = await supabase.from('system_settings').select('key, value, is_approved, note, approved_at, updated_at').order('key'); if (e) throw e; return data as SystemSetting[]; },
  });
  const refresh = () => { setEditing(null); setError(null); void qc.invalidateQueries({ queryKey: ['system-settings'] }); };
  const saveValue = useMutation({
    mutationFn: async (key: string) => { const p = parseSettingValue(text); if (p.error) throw new Error(p.error); const { error: e } = await supabase.from('system_settings').update({ value: p.value }).eq('key', key); if (e) throw e; },
    onSuccess: refresh, onError: (e: Error) => setError(e.message),
  });
  const approve = useMutation({
    mutationFn: async (v: { key: string; approved: boolean }) => { const { error: e } = await supabase.from('system_settings').update({ is_approved: v.approved }).eq('key', v.key); if (e) throw e; },
    onSuccess: refresh, onError: (e: Error) => setError(e.message),
  });
  if (q.isLoading) return <p role="status">Loading…</p>;
  if (q.isError) return <p role="alert" className="text-danger">Could not load settings.</p>;
  return (
    <div className="grid gap-3">
      <h2 className="font-display text-lg font-semibold">System settings</h2>
      <p className="text-sm text-ink/70">The values below are stored configuration. Some, such as the assessment weights, are not yet read by the screens: the results page still uses the draft numbers built into the code, so changing a value here does not change results.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!q.data?.length ? <EmptyState title="No settings stored">The database seed adds the draft settings.</EmptyState> : (
        <ul className="grid gap-3">
          {q.data.map((s) => (
            <li key={s.key} className="rounded-card border border-purple-100 p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-mono font-semibold">{s.key}</h3>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${s.is_approved ? 'bg-green-100 text-ok' : 'bg-amber-100 text-warn'}`}>{s.is_approved ? 'Approved' : 'Draft'}</span>
              </div>
              {s.note && <p className="mt-1 text-ink/70">{s.note}</p>}
              {editing === s.key ? (
                <div className="mt-2 grid gap-2">
                  <label className="grid gap-1 font-medium">Value (JSON)<textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} className={`${field} font-mono`} /></label>
                  <div className="flex gap-2"><Button type="button" disabled={saveValue.isPending} onClick={() => saveValue.mutate(s.key)}>Save</Button><Button variant="quiet" type="button" onClick={() => setEditing(null)}>Cancel</Button></div>
                </div>
              ) : (
                <>
                  <pre className="mt-2 overflow-x-auto rounded-control bg-purple-50 p-2 font-mono text-xs">{formatSettingValue(s.value)}</pre>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button variant="quiet" type="button" onClick={() => { setEditing(s.key); setText(formatSettingValue(s.value)); setError(null); }}>Edit value</Button>
                    {s.is_approved
                      ? <Button variant="quiet" type="button" onClick={() => approve.mutate({ key: s.key, approved: false })}>Withdraw approval</Button>
                      : <Button variant="accent" type="button" onClick={() => { if (window.confirm(`Approve "${s.key}" on behalf of management?`)) approve.mutate({ key: s.key, approved: true }); }}>Approve</Button>}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
