import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { FILE_NOT_AVAILABLE } from '@/lib/files';
import { useAuth } from '@/features/auth/AuthProvider';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import type { ApplicationEvent, ApplicationStatus } from '@/types/database';
import { ageFromDob, canConvert, canDecide, decisionGroup, GROUP_LABEL, matchesSearch, MAX_REASON_LENGTH, noteRequired, reviewMoves, STATUS_LABEL, type DecisionGroup } from './workflow';

interface AppRow {
  id: string; status: ApplicationStatus; submitted_at: string | null; form_data: Record<string, unknown>;
  preferred_track_id: string | null; applicant_id: string;
  tracks: { name: string } | null;
  participants: { id: string } | { id: string }[] | null;   // one-to-one embed: PostgREST returns an object, not an array
}
interface DocRow { id: string; doc_type: string; storage_path: string; mime_type: string }
interface EventRow extends ApplicationEvent { profiles: { first_name: string; last_name: string } | null }

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const fullName = (a: AppRow) => `${str(a.form_data.firstName)} ${str(a.form_data.lastName)}`.trim() || 'Unnamed applicant';

const KNOWN_FIELDS = ['firstName', 'lastName', 'dateOfBirth', 'phone', 'location', 'educationLevel', 'institution', 'skills', 'interests', 'preferredTrackId', 'motivation', 'consent'];
const badgeText = (s: ApplicationStatus) => (decisionGroup(s) === 'pending' && s !== 'submitted' ? `Pending · ${STATUS_LABEL[s]}` : (GROUP_LABEL[decisionGroup(s) ?? 'pending']));
const badgeClass = (s: ApplicationStatus) => decisionGroup(s) === 'approved' ? 'bg-ok/10 text-ok' : decisionGroup(s) === 'rejected' ? 'bg-danger/10 text-danger' : 'bg-purple-100 text-purple-700';

export function ApplicationsReviewPage() {
  const [filter, setFilter] = useState<DecisionGroup | 'all'>('pending');
  const [search, setSearch] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['applications-review'],
    queryFn: async () => {
      const { data, error } = await supabase.from('applications')
        .select('id, status, submitted_at, form_data, preferred_track_id, applicant_id, tracks(name), participants(id)')
        .neq('status', 'draft').order('submitted_at', { ascending: true, nullsFirst: false });
      if (error) throw error;
      return data as unknown as AppRow[];
    },
  });

  // Applicant emails come from a staff-only database function (auth.users is not readable from the browser). Not essential, so a failure just hides them.
  const emailQ = useQuery({
    queryKey: ['application-emails'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('application_emails');
      if (error) throw error;
      return new Map((data as { application_id: string; email: string }[]).map((r) => [r.application_id, r.email]));
    },
    retry: false,
  });
  const emailOf = (id: string) => emailQ.data?.get(id) ?? '';

  if (list.isLoading) return <p role="status">Loading applications…</p>;
  if (list.isError) return <p role="alert" className="text-danger">Could not load applications. Check your connection and try again.</p>;

  const all = list.data ?? [];
  const counts = (g: DecisionGroup) => all.filter((a) => decisionGroup(a.status) === g).length;
  const shown = all.filter((a) => (filter === 'all' || decisionGroup(a.status) === filter)
    && matchesSearch(`${fullName(a)} ${emailOf(a.id)} ${str(a.form_data.location)} ${str(a.form_data.phone)}`, search));
  const open = all.find((a) => a.id === openId) ?? null;

  return (
    <section className="grid gap-5">
      <h1 className="text-2xl font-bold text-purple-700">Applications management</h1>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
        {(['all', 'pending', 'approved', 'rejected'] as const).map((s) => (
          <button key={s} role="tab" aria-selected={filter === s} onClick={() => setFilter(s)}
            className={`rounded-control px-3 py-1.5 text-sm ${filter === s ? 'bg-purple-600 font-semibold text-white' : 'bg-purple-50 text-purple-700 hover:bg-purple-100'}`}>
            {s === 'all' ? 'All' : GROUP_LABEL[s]} <span className="opacity-70">({s === 'all' ? all.length : counts(s)})</span>
          </button>
        ))}
      </div>
      <label className="grid max-w-sm gap-1 text-sm font-medium">Search by name, email, phone or location
        <input className="rounded-control border border-purple-200 px-3 py-2 font-normal" value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {shown.length === 0
          ? <EmptyState title="No applications here">{all.length === 0 ? 'Submitted applications will appear here.' : 'Try a different status or search.'}</EmptyState>
          : (
            <ul className="divide-y divide-purple-100 self-start rounded-card border border-purple-100">
              {shown.map((a) => (
                <li key={a.id}>
                  <button onClick={() => setOpenId(a.id)} aria-current={a.id === openId}
                    className={`flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-purple-50 ${a.id === openId ? 'bg-purple-50' : ''}`}>
                    <span>
                      <span className="block font-medium">{fullName(a)}</span>
                      <span className="block text-xs text-ink/60">{emailOf(a.id) || 'No email shown'}</span>
                      <span className="text-xs text-ink/60">{str(a.form_data.location) || 'No location'} · {a.tracks?.name ?? 'No preferred track'}</span>
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badgeClass(a.status)}`}>{badgeText(a.status)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        {open ? <ApplicationDetail key={open.id} app={open} email={emailOf(open.id)} /> : <EmptyState title="Choose an application">Its details, documents and history will show here.</EmptyState>}
      </div>
    </section>
  );
}

function ApplicationDetail({ app, email }: { app: AppRow; email: string }) {
  const { profile } = useAuth();
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState<'approve' | 'reject' | null>(null);
  const [reason, setReason] = useState('');
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['applications-review'] });
    void qc.invalidateQueries({ queryKey: ['application-events', app.id] });
    void qc.invalidateQueries({ queryKey: ['application-funnel'] });
    void qc.invalidateQueries({ queryKey: ['application-emails'] });
  };

  const docs = useQuery({
    queryKey: ['application-docs', app.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('application_documents').select('id, doc_type, storage_path, mime_type').eq('application_id', app.id);
      if (error) throw error;
      return data as DocRow[];
    },
  });
  const events = useQuery({
    queryKey: ['application-events', app.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('application_events')
        .select('id, from_status, to_status, note, actor_id, created_at, profiles:actor_id(first_name, last_name)').eq('application_id', app.id).order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as EventRow[];
    },
  });

  const move = useMutation({
    mutationFn: async (to: ApplicationStatus) => {
      const { error } = await supabase.rpc('transition_application', { p_app: app.id, p_to: to, p_note: note.trim() || null });
      if (error) throw error;
    },
    onSuccess: () => { setNote(''); refresh(); },
  });
  // Approve / Reject run on the server (decide_application): it checks the role, updates the profile and participant record,
  // writes the history and audit log, and queues the email, all in one transaction.
  const decide = useMutation({
    mutationFn: async (decision: 'approve' | 'reject') => {
      const { error } = await supabase.rpc('decide_application', { p_app: app.id, p_decision: decision, p_reason: decision === 'reject' ? reason.trim() || null : null });
      if (error) throw error;
      return decision;
    },
    onSuccess: () => { setConfirming(null); setReason(''); setNote(''); refresh(); },
  });
  const addNote = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('application_events').insert({ application_id: app.id, note: note.trim() });
      if (error) throw error;
    },
    onSuccess: () => { setNote(''); refresh(); },
  });
  const convert = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('convert-application', { body: { applicationId: app.id } });
      if (error) throw error;
      return data as { participantId: string };
    },
    onSuccess: refresh,
  });
  const openDoc = async (d: DocRow) => {
    const { data, error } = await supabase.storage.from('application-documents').createSignedUrl(d.storage_path, 300);
    if (error || !data) { window.alert(FILE_NOT_AVAILABLE); return; }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const f = app.form_data;
  const age = ageFromDob(f.dateOfBirth);
  const converted = Array.isArray(app.participants) ? app.participants.length > 0 : Boolean(app.participants);
  const options = reviewMoves(app.status);
  const mayDecide = !!profile && canDecide(profile.role, app.status, app.applicant_id, profile.id);
  const extras = Object.entries(f).filter(([k, v]) => !KNOWN_FIELDS.includes(k) && (typeof v === 'string' || typeof v === 'number') && String(v).trim() !== '');
  const rows: [string, string][] = [
    ['Email', email], ['Date of birth', str(f.dateOfBirth)], ['Age', age === null ? 'Not given' : String(age)], ['Phone', str(f.phone)], ['Location', str(f.location)],
    ['Education', `${str(f.educationLevel)}${str(f.institution) ? `, ${str(f.institution)}` : ''}`],
    ['Preferred track', app.tracks?.name ?? 'None chosen'], ['Skills', str(f.skills)], ['Interests', str(f.interests)],
    ...extras.map(([k, v]): [string, string] => [k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()), String(v)]),
    ['Data-use consent', f.consent === true ? 'Given' : ''],
  ];

  return (
    <article className="grid gap-4 self-start rounded-card border border-purple-100 p-5" aria-label={`Application from ${fullName(app)}`}>
      <header>
        <h2 className="font-display text-xl font-semibold text-purple-900">{fullName(app)}</h2>
        <p className="text-sm text-ink/60">{GROUP_LABEL[decisionGroup(app.status) ?? 'pending']} · {STATUS_LABEL[app.status]}{app.submitted_at ? ` · submitted ${new Date(app.submitted_at).toLocaleDateString()}` : ''}</p>
      </header>
      <dl className="grid gap-2 text-sm sm:grid-cols-[120px_1fr]">
        {rows.filter(([, v]) => v).map(([k, v]) => (<div key={k} className="contents"><dt className="font-medium text-ink/70">{k}</dt><dd>{v}</dd></div>))}
      </dl>
      <div>
        <h3 className="text-sm font-semibold text-ink/70">Why they want to join</h3>
        <p className="mt-1 whitespace-pre-wrap text-sm">{str(f.motivation) || 'Not given'}</p>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-ink/70">Documents</h3>
        {docs.isLoading ? <p role="status" className="text-sm">Loading…</p>
          : docs.data?.length ? <ul className="mt-1 text-sm">{docs.data.map((d) => <li key={d.id}><button className="text-purple-700 underline" onClick={() => void openDoc(d)}>{d.doc_type}</button></li>)}</ul>
          : <p className="text-sm text-ink/60">No documents uploaded.</p>}
      </div>

      {decisionGroup(app.status) === 'pending' && (
        <div className="grid gap-3 rounded-card border border-purple-200 bg-purple-50/60 p-4" aria-label="Decision">
          <h3 className="text-sm font-semibold text-purple-900">Decision</h3>
          {!mayDecide ? (
            <p className="text-sm text-ink/70">{profile && app.applicant_id === profile.id ? 'You cannot decide your own application.' : 'Only a super administrator or programme director can approve or reject applications.'}</p>
          ) : confirming === null ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="accent" onClick={() => setConfirming('approve')}>Approve</Button>
              <Button variant="quiet" onClick={() => setConfirming('reject')}>Reject</Button>
            </div>
          ) : confirming === 'approve' ? (
            <div className="grid gap-2">
              <p className="text-sm">Approve <strong>{fullName(app)}</strong>? They become a participant straight away and are emailed.</p>
              <div className="flex gap-2">
                <Button variant="accent" disabled={decide.isPending} onClick={() => decide.mutate('approve')}>{decide.isPending ? 'Approving…' : 'Yes, approve'}</Button>
                <Button variant="quiet" disabled={decide.isPending} onClick={() => setConfirming(null)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="grid gap-2">
              <p className="text-sm">Reject <strong>{fullName(app)}</strong>? They keep no participant access and are emailed.</p>
              <label className="grid gap-1 text-sm font-medium">Reason (optional; kept in the history and audit log, not sent to the applicant)
                <textarea className="min-h-20 rounded-control border border-purple-200 px-3 py-2 font-normal" maxLength={MAX_REASON_LENGTH} value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <div className="flex gap-2">
                <Button variant="primary" disabled={decide.isPending} onClick={() => decide.mutate('reject')}>{decide.isPending ? 'Rejecting…' : 'Yes, reject'}</Button>
                <Button variant="quiet" disabled={decide.isPending} onClick={() => setConfirming(null)}>Cancel</Button>
              </div>
            </div>
          )}
          {decide.isError && <p role="alert" className="text-sm text-danger">{(decide.error as Error).message}</p>}
        </div>
      )}
      {app.status === 'accepted' && converted && <p role="status" className="text-sm text-ok">Approved. This applicant now has participant access. Enrol them in a cohort from the Cohorts page.</p>}
      {app.status === 'rejected' && <p role="status" className="text-sm text-danger">Rejected. This applicant has no participant access.</p>}

      <div className="grid gap-2 border-t border-purple-100 pt-4">
        <label className="grid gap-1 text-sm font-medium">Reviewer note (staff only)
          <textarea className="min-h-20 rounded-control border border-purple-200 px-3 py-2 font-normal" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2">
          {options.map((to) => (
            <Button key={to} variant="primary"
              disabled={move.isPending || (noteRequired(app.status, to) && note.trim() === '')}
              title={noteRequired(app.status, to) && note.trim() === '' ? 'Write a note first' : undefined}
              onClick={() => move.mutate(to)}>{app.status === 'rejected' ? 'Reconsider (back to under review)' : `Mark ${STATUS_LABEL[to].toLowerCase()}`}</Button>
          ))}
          <Button variant="quiet" disabled={addNote.isPending || note.trim() === ''} onClick={() => addNote.mutate()}>Save note only</Button>
          {profile && canConvert(profile.role, app.status, converted) && (
            <Button variant="accent" disabled={convert.isPending} onClick={() => convert.mutate()}>Convert to participant (older approvals)</Button>
          )}
        </div>
        {[move, addNote, convert].map((m, i) => m.isError && <p key={i} role="alert" className="text-sm text-danger">{(m.error as Error).message}</p>)}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-ink/70">History</h3>
        {events.isLoading ? <p role="status" className="text-sm">Loading…</p> : (
          <ol className="mt-1 grid gap-2 text-sm">
            {events.data?.map((e) => (
              <li key={e.id} className="border-l-2 border-purple-200 pl-3">
                <span className="font-medium">{e.to_status && e.to_status !== e.from_status ? `${e.from_status ? STATUS_LABEL[e.from_status] + ' → ' : ''}${STATUS_LABEL[e.to_status]}` : 'Note'}</span>
                <span className="text-ink/60"> · {new Date(e.created_at).toLocaleString()}{e.profiles ? ` · ${e.profiles.first_name} ${e.profiles.last_name}` : ''}</span>
                {e.note && <p className="whitespace-pre-wrap">{e.note}</p>}
              </li>
            ))}
            {!events.data?.length && <li className="text-ink/60">No history yet.</li>}
          </ol>
        )}
      </div>
    </article>
  );
}
