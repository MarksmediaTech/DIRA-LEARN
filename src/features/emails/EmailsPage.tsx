import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { readFunctionErrorMessage } from '@/lib/functionError';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { EmailOutboxRow, EmailStatus, EmailTemplate } from '@/types/database';
import { BULK_VARS, STATUS_LABEL, SYSTEM_VARS, scheduleInstant, summarise, validateTemplate } from './rules';

type Tab = 'outbox' | 'templates' | 'send';
const field = 'rounded-control border border-purple-200 px-3 py-2 font-normal';
const TABS: [Tab, string][] = [['outbox', 'Activity'], ['templates', 'Templates'], ['send', 'Send an email']];

export function EmailsPage() {
  const [tab, setTab] = useState<Tab>('outbox');
  return (
    <section className="grid max-w-5xl gap-5">
      <h1 className="text-2xl font-bold text-purple-700">Email</h1>
      <ProviderStatus />
      <div role="tablist" aria-label="Email sections" className="flex gap-2 border-b border-purple-100">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold ${tab === k ? 'border-purple-600 text-purple-700' : 'border-transparent text-ink/60'}`}>{l}</button>
        ))}
      </div>
      {tab === 'outbox' && <Outbox />}
      {tab === 'templates' && <Templates />}
      {tab === 'send' && <Send />}
    </section>
  );
}

function ProviderStatus() {
  const qc = useQueryClient();
  const st = useQuery({
    queryKey: ['email-provider'], retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('send-emails', { body: { action: 'status' } });
      if (error) throw error;
      return data as { configured: boolean; cronSecretSet: boolean };
    },
  });
  const auto = useQuery({
    queryKey: ['email-automation'],
    queryFn: async () => { const { data, error } = await supabase.from('system_settings').select('value, is_approved').eq('key', 'email_automation').maybeSingle(); if (error) throw error; return data as { value: { enabled?: boolean }; is_approved: boolean } | null; },
  });
  const [msg, setMsg] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('send-emails', { body: { action: 'run' } });
      if (error) throw new Error(await readFunctionErrorMessage(error));   // safe for every Supabase function error type (no context.json() on a network error)
      return data as { sent: number; failed: number; claimed: number; remindersQueued: number };
    },
    onSuccess: (d) => { setMsg(`Processed ${d.claimed} queued emails: ${d.sent} handed to the provider, ${d.failed} failed. ${d.remindersQueued} reminders were queued.`); void qc.invalidateQueries({ queryKey: ['email-outbox'] }); },
    onError: (e: Error) => setMsg(e.message),
  });
  const on = Boolean(auto.data?.value?.enabled && auto.data.is_approved);
  return (
    <div className="grid gap-2 rounded-card border border-purple-100 p-4 text-sm">
      <p>
        <strong>Email provider:</strong>{' '}
        {st.isLoading ? 'checking…' : st.isError ? 'could not check (the send-emails function is not deployed or not reachable)' : st.data?.configured ? 'connected' : 'not connected. Emails stay queued until RESEND_API_KEY and EMAIL_FROM are set (see docs/EMAIL_SETUP.md).'}
      </p>
      <p><strong>Automatic emails (reminders and event emails):</strong> {on ? 'on' : 'off'}. {on ? '' : 'Turn this on under Settings by setting email_automation to {"enabled": true} and approving it.'}</p>
      {st.data && !st.data.cronSecretSet && <p className="text-warn">No CRON_SECRET is set, so nothing sends on a schedule. Use the button below, or set up the scheduler.</p>}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="quiet" disabled={run.isPending || !st.data?.configured} onClick={() => { setMsg(null); run.mutate(); }}>{run.isPending ? 'Sending…' : 'Send queued emails now'}</Button>
        {msg && <span role="status">{msg}</span>}
      </div>
    </div>
  );
}

function Outbox() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<EmailStatus | ''>('');
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['email-outbox'],
    queryFn: async () => {
      const { data, error: e } = await supabase.from('email_outbox').select('id, to_email, template_key, campaign, subject, status, scheduled_for, attempts, error, sent_at, created_at').order('created_at', { ascending: false }).limit(300);
      if (e) throw e; return data as EmailOutboxRow[];
    },
  });
  const cancel = useMutation({
    mutationFn: async (id: string) => { const { error: e } = await supabase.rpc('cancel_email', { p_id: id }); if (e) throw e; },
    onSuccess: () => { setError(null); void qc.invalidateQueries({ queryKey: ['email-outbox'] }); }, onError: (e: Error) => setError(e.message),
  });
  const counts = useMemo(() => summarise(q.data ?? []), [q.data]);
  if (q.isLoading) return <p role="status">Loading…</p>;
  if (q.isError) return <p role="alert" className="text-danger">Could not load email activity.</p>;
  const rows = (q.data ?? []).filter((r) => !status || r.status === status);
  return (
    <div className="grid gap-4">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(['queued', 'sent', 'delivered', 'bounced', 'complained', 'failed'] as EmailStatus[]).map((s) => (
          <div key={s} className="rounded-card border border-purple-100 p-3"><dt className="text-xs text-ink/70">{STATUS_LABEL[s]}</dt><dd className="font-display text-2xl font-bold">{counts[s]}</dd></div>
        ))}
      </dl>
      <p className="text-xs text-ink/60">Counts cover the latest 300 emails. &ldquo;Sent to provider&rdquo; means handed over; &ldquo;Delivered&rdquo; appears only after the provider confirms it through the webhook.</p>
      <label className="grid max-w-xs gap-1 text-sm font-medium">Show
        <select value={status} onChange={(e) => setStatus(e.target.value as EmailStatus | '')} className={field}><option value="">All</option>{(Object.keys(STATUS_LABEL) as EmailStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
      </label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {!rows.length ? <EmptyState title="No emails">Emails you send or that automation creates appear here.</EmptyState> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm"><caption className="sr-only">Email activity</caption>
            <thead><tr className="border-b border-purple-200"><th scope="col" className="p-2">To</th><th scope="col" className="p-2">Subject</th><th scope="col" className="p-2">Status</th><th scope="col" className="p-2">When</th><th scope="col" className="p-2"><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="border-b border-purple-100 align-top">
                <td className="p-2">{r.to_email}{r.campaign && <div className="text-xs text-ink/60">{r.campaign}</div>}</td>
                <td className="p-2">{r.subject}</td>
                <td className="p-2">{STATUS_LABEL[r.status]}{r.error && <div className="max-w-xs text-xs text-danger">{r.error}</div>}{r.attempts > 0 && <div className="text-xs text-ink/60">Attempts: {r.attempts}</div>}</td>
                <td className="p-2 whitespace-nowrap">{new Date(r.sent_at ?? r.scheduled_for).toLocaleString()}</td>
                <td className="p-2">{r.status === 'queued' && <Button variant="quiet" type="button" onClick={() => cancel.mutate(r.id)}>Cancel</Button>}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Templates() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['email-templates'],
    queryFn: async () => { const { data, error } = await supabase.from('email_templates').select('id, key, name, subject, body, is_system, is_active, updated_at').order('is_system', { ascending: false }).order('name'); if (error) throw error; return data as EmailTemplate[]; },
  });
  const [editing, setEditing] = useState<EmailTemplate | 'new' | null>(null);
  const [f, setF] = useState({ key: '', name: '', subject: '', body: '', is_active: true });
  const [msg, setMsg] = useState<string | null>(null);
  const open = (t: EmailTemplate | 'new') => { setEditing(t); setMsg(null); setF(t === 'new' ? { key: '', name: '', subject: '', body: '', is_active: true } : { key: t.key, name: t.name, subject: t.subject, body: t.body, is_active: t.is_active }); };
  const allowed = editing && editing !== 'new' && SYSTEM_VARS[editing.key] ? SYSTEM_VARS[editing.key]! : BULK_VARS;
  const save = useMutation({
    mutationFn: async () => {
      const problem = validateTemplate(f, allowed, editing === 'new'); if (problem) throw new Error(problem);
      const body = { name: f.name.trim(), subject: f.subject.trim(), body: f.body, is_active: f.is_active };
      const res = editing === 'new' ? await supabase.from('email_templates').insert({ key: f.key, ...body }) : await supabase.from('email_templates').update(body).eq('id', (editing as EmailTemplate).id);
      if (res.error) throw res.error;
    },
    onSuccess: () => { setEditing(null); void qc.invalidateQueries({ queryKey: ['email-templates'] }); }, onError: (e: Error) => setMsg(e.message),
  });
  const del = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.from('email_templates').delete().eq('id', id); if (error) throw error; },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['email-templates'] }), onError: (e: Error) => setMsg(e.message),
  });
  if (q.isLoading) return <p role="status">Loading…</p>;
  if (q.isError) return <p role="alert" className="text-danger">Could not load templates.</p>;
  if (editing) {
    return (
      <form className="grid gap-3 rounded-card border border-purple-100 p-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <h2 className="font-display text-lg font-semibold">{editing === 'new' ? 'New template' : `Edit: ${editing.name}`}</h2>
        {editing === 'new' && <label className="grid gap-1 text-sm font-medium">Key <span className="font-normal text-ink/60">(permanent; letters, digits, underscores)</span><input value={f.key} onChange={(e) => setF({ ...f, key: e.target.value })} className={field} /></label>}
        <label className="grid gap-1 text-sm font-medium">Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={field} /></label>
        <label className="grid gap-1 text-sm font-medium">Subject<input value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} className={field} /></label>
        <label className="grid gap-1 text-sm font-medium">Message<textarea rows={8} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} className={field} /></label>
        <p className="text-xs text-ink/70">Available placeholders: {allowed.map((a) => `{{${a}}}`).join(', ')}. Plain text only; the DIRA layout is added when it is sent.</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /> Active</label>
        {msg && <p role="alert" className="text-sm text-danger">{msg}</p>}
        <div className="flex gap-2"><Button type="submit" disabled={save.isPending}>Save template</Button><Button type="button" variant="quiet" onClick={() => setEditing(null)}>Cancel</Button></div>
      </form>
    );
  }
  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between"><p className="text-sm text-ink/70">System templates are used by automation. Their wording is a draft: review it before switching automation on.</p><Button type="button" onClick={() => open('new')}>New template</Button></div>
      {msg && <p role="alert" className="text-sm text-danger">{msg}</p>}
      <ul className="grid gap-3">
        {(q.data ?? []).map((t) => (
          <li key={t.id} className="rounded-card border border-purple-100 p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">{t.name} <span className="font-mono text-xs font-normal text-ink/60">{t.key}</span>{t.is_system && <span className="ml-2 rounded-full bg-purple-50 px-2 py-0.5 text-xs">System</span>}{!t.is_active && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs">Off</span>}</h3>
              <div className="flex gap-2"><Button variant="quiet" type="button" onClick={() => open(t)}>Edit</Button>{!t.is_system && <Button variant="quiet" type="button" onClick={() => { if (window.confirm(`Delete "${t.name}"?`)) del.mutate(t.id); }}>Delete</Button>}</div>
            </div>
            <p className="mt-1 font-medium">{t.subject}</p><p className="mt-1 whitespace-pre-wrap text-ink/80">{t.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Send() {
  const qc = useQueryClient();
  const templates = useQuery({
    queryKey: ['email-templates'],
    queryFn: async () => { const { data, error } = await supabase.from('email_templates').select('id, key, name, subject, body, is_system, is_active, updated_at').eq('is_active', true).order('name'); if (error) throw error; return data as EmailTemplate[]; },
  });
  const cohorts = useQuery({
    queryKey: ['email-cohorts'],
    queryFn: async () => { const { data, error } = await supabase.from('cohorts').select('id, name').eq('archived', false).order('start_date', { ascending: false }); if (error) throw error; return data as { id: string; name: string }[]; },
  });
  const [tpl, setTpl] = useState(''); const [audience, setAudience] = useState('cohort'); const [cohort, setCohort] = useState('');
  const [date, setDate] = useState(''); const [time, setTime] = useState(''); const [msg, setMsg] = useState<string | null>(null);
  const usable = (templates.data ?? []).filter((t) => !SYSTEM_VARS[t.key]);
  const chosen = usable.find((t) => t.key === tpl);
  const send = useMutation({
    mutationFn: async () => {
      if (!tpl) throw new Error('Choose a template.');
      if (audience === 'cohort' && !cohort) throw new Error('Choose a cohort.');
      const s = scheduleInstant(date, time, new Date()); if (s.error) throw new Error(s.error);
      const { data, error } = await supabase.rpc('enqueue_bulk_email', { p_template: tpl, p_audience: audience, p_cohort: audience === 'cohort' ? cohort : null, p_when: s.iso });
      if (error) throw error; return data as number;
    },
    onSuccess: (n) => { setMsg(`${n} emails queued${date ? ' for the scheduled time' : ''}. They are sent when the sender next runs (or press "Send queued emails now").`); void qc.invalidateQueries({ queryKey: ['email-outbox'] }); },
    onError: (e: Error) => setMsg(e.message),
  });
  return (
    <form className="grid max-w-2xl gap-4 rounded-card border border-purple-100 p-4" onSubmit={(e) => { e.preventDefault(); setMsg(null); send.mutate(); }}>
      <h2 className="font-display text-lg font-semibold">Send an email to a group</h2>
      <p className="text-sm text-ink/70">Write the message as a template first (Templates tab), then send it here. Each person gets their own copy with their details filled in. People who opted out are skipped. Up to 500 people per send.</p>
      <label className="grid gap-1 text-sm font-medium">Template
        <select value={tpl} onChange={(e) => setTpl(e.target.value)} className={field}><option value="">Choose a template</option>{usable.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</select>
      </label>
      {chosen && <div className="rounded-control bg-purple-50 p-3 text-sm"><p className="font-semibold">{chosen.subject}</p><p className="mt-1 whitespace-pre-wrap">{chosen.body}</p></div>}
      <label className="grid gap-1 text-sm font-medium">Send to
        <select value={audience} onChange={(e) => setAudience(e.target.value)} className={field}>
          <option value="cohort">A cohort&apos;s participants</option><option value="all_participants">All participants</option><option value="all_staff">All staff, trainers and mentors</option>
        </select>
      </label>
      {audience === 'cohort' && <label className="grid gap-1 text-sm font-medium">Cohort
        <select value={cohort} onChange={(e) => setCohort(e.target.value)} className={field}><option value="">Choose a cohort</option>{(cohorts.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </label>}
      <fieldset className="grid gap-2"><legend className="text-sm font-medium">Schedule <span className="font-normal text-ink/60">(leave empty to send as soon as possible)</span></legend>
        <div className="flex flex-wrap gap-3"><label className="grid gap-1 text-sm">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} /></label><label className="grid gap-1 text-sm">Time<input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={field} /></label></div>
      </fieldset>
      {msg && <p role="status" className="text-sm">{msg}</p>}
      <Button type="submit" disabled={send.isPending} className="justify-self-start" onClick={(e) => { if (!window.confirm('Queue this email for the chosen group?')) e.preventDefault(); }}>Queue emails</Button>
    </form>
  );
}
