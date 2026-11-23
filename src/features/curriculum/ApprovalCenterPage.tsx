import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import {
  actionsFor, canReviewTopics, commentRequired, filterProposals, groupByTrack, MAX_COMMENT_LENGTH, NO_FILTERS, sessionOptions, summarise,
  TOPIC_STATUS_LABEL, validateComment, type Filters, type ProposalRow, type TopicDecision, type TopicStatus, type TrackInfo,
} from './approvalRules';

interface HistoryRow { id: number; from_status: TopicStatus | null; to_status: TopicStatus; actor_name: string | null; comment: string | null; created_at: string }
type DialogState = { kind: TopicDecision | 'details'; topic: ProposalRow } | null;

const field = 'rounded-control border border-purple-200 px-3 py-2 text-sm font-normal';
const badge: Record<TopicStatus, string> = { pending: 'bg-purple-100 text-purple-700', approved: 'bg-ok/10 text-ok', rejected: 'bg-danger/10 text-danger' };
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export function ApprovalCenterPage() {
  const { profile } = useAuth();
  const canReview = canReviewTopics(profile?.role);
  const qc = useQueryClient();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const q = useQuery({
    queryKey: ['curriculum-proposals'],
    enabled: canReview,
    queryFn: async () => {
      const [p, t] = await Promise.all([supabase.rpc('curriculum_proposals_list'), supabase.from('tracks').select('id, name, position').order('position')]);
      if (p.error) throw p.error;
      if (t.error) throw t.error;
      return { rows: p.data as ProposalRow[], tracks: t.data as TrackInfo[] };
    },
  });
  const rows = useMemo(() => q.data?.rows ?? [], [q.data?.rows]);   // same array between renders, so the memos below only recompute when the data changes
  const shown = useMemo(() => filterProposals(rows, filters), [rows, filters]);
  const groups = useMemo(() => groupByTrack(shown, q.data?.tracks ?? []), [shown, q.data?.tracks]);
  const summary = summarise(rows);
  const sessions = useMemo(() => sessionOptions(rows, filters.trackId), [rows, filters.trackId]);

  const review = useMutation({
    mutationFn: async (v: { id: string; decision: TopicDecision; comment: string }) => {
      const { error } = await supabase.rpc('review_curriculum_topic', { p_id: v.id, p_decision: v.decision, p_comment: v.comment.trim() || null });
      if (error) throw error;
      return v;
    },
    onSuccess: (v) => {
      setDialog(null);
      setNotice({ ok: true, text: v.decision === 'approve' ? 'Topic approved. It is now part of the official curriculum.' : v.decision === 'reject' ? 'Topic rejected. It stays in the history.' : 'Topic returned to pending approval.' });
      void qc.invalidateQueries({ queryKey: ['curriculum-proposals'] });
      void qc.invalidateQueries({ queryKey: ['curriculum-pending-count'] });
      void qc.invalidateQueries({ queryKey: ['session-topics'] });
      void qc.invalidateQueries({ queryKey: ['curriculum'] }); // the Curriculum page lists approved/awaiting topics under this key
    },
    onError: (e: Error) => { setDialog(null); setNotice({ ok: false, text: e.message }); },
  });

  useEffect(() => { if (!notice?.ok) return; const id = window.setTimeout(() => setNotice(null), 6000); return () => window.clearTimeout(id); }, [notice]);

  if (!canReview) return <EmptyState title="Curriculum Approval Centre">Only the Founder, Co-Founder and Super Administrator can review proposed topics.</EmptyState>;
  if (q.isLoading) return <p role="status">Loading proposed topics…</p>;
  if (q.isError) return <p role="alert" className="text-danger">Could not load the proposed topics. {(q.error as Error).message}</p>;
  if (rows.length === 0) return <EmptyState title="No proposed topics yet">Topics proposed for the curriculum will appear here for approval.</EmptyState>;

  const set = (patch: Partial<Filters>) => setFilters((f) => ({ ...f, ...patch }));
  const cards: { label: string; value: number; tone: string }[] = [
    { label: 'Total proposed topics', value: summary.total, tone: 'text-purple-900' }, { label: 'Pending approval', value: summary.pending, tone: 'text-dira-orange' },
    { label: 'Approved', value: summary.approved, tone: 'text-ok' }, { label: 'Rejected', value: summary.rejected, tone: 'text-danger' },
  ];

  return (
    <section className="grid gap-5">
      <header>
        <h1 className="text-2xl font-bold text-purple-700">Curriculum Approval Centre</h1>
        <p className="mt-1 max-w-2xl text-sm text-ink/70">Review the topics proposed for each learning track. An approved topic becomes part of the official curriculum for its session. Pending and rejected topics are never taught as official content.</p>
      </header>

      {notice && <p role={notice.ok ? 'status' : 'alert'} className={`rounded-control border px-3 py-2 text-sm ${notice.ok ? 'border-ok/30 bg-ok/10 text-ok' : 'border-danger/30 bg-danger/10 text-danger'}`}>{notice.text}</p>}

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((c) => (<div key={c.label} className="rounded-card border border-purple-100 bg-white p-4 shadow-sm"><dt className="text-xs font-medium text-ink/60">{c.label}</dt><dd className={`font-display text-3xl font-bold ${c.tone}`}>{c.value}</dd></div>))}
      </dl>

      <div className="grid gap-3 rounded-card border border-purple-100 bg-purple-50/40 p-4">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by status">
          {([['all', 'All topics', summary.total], ['pending', 'Pending approval', summary.pending], ['approved', 'Approved', summary.approved], ['rejected', 'Rejected', summary.rejected]] as const).map(([v, label, n]) => (
            <button key={v} role="tab" aria-selected={filters.status === v} onClick={() => set({ status: v })}
              className={`rounded-control px-3 py-1.5 text-sm ${filters.status === v ? 'bg-purple-600 font-semibold text-white' : 'bg-white text-purple-700 hover:bg-purple-100'}`}>{label} <span className="opacity-70">({n})</span></button>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm font-medium">Learning track
            <select className={field} value={filters.trackId} onChange={(e) => set({ trackId: e.target.value, sessionId: 'all' })}>
              <option value="all">All tracks</option>{(q.data?.tracks ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">Session
            <select className={field} value={filters.sessionId} onChange={(e) => set({ sessionId: e.target.value })}>
              <option value="all">All sessions</option>{sessions.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">Search by topic title
            <input className={field} value={filters.search} onChange={(e) => set({ search: e.target.value })} placeholder="e.g. SEO" />
          </label>
        </div>
      </div>

      {shown.length === 0 && <EmptyState title="No topics match">Try a different status, track, session or search.</EmptyState>}
      {groups.filter((g) => g.sessions.length > 0 || (filters.status === 'all' && filters.trackId === 'all' && filters.sessionId === 'all' && filters.search.trim() === '')).map((g) => (
        <div key={g.trackId ?? 'core'} className="grid gap-3">
          <h2 className="font-display text-xl font-semibold text-purple-900">{g.trackName}</h2>
          {g.sessions.length === 0 && <p className="text-sm text-ink/60">No topics have been proposed for this track. Its existing sessions are unchanged.</p>}
          {g.sessions.map((s) => (
            <div key={s.sessionId} className="rounded-card border border-purple-100 bg-white">
              <p className="border-b border-purple-100 bg-purple-50/60 px-4 py-2 text-sm font-semibold text-purple-900">Week {s.weekNo} · Session {s.sessionNo}: {s.title}</p>
              <ul className="divide-y divide-purple-100">
                {s.topics.map((t) => (
                  <li key={t.id} className="grid gap-2 p-4 sm:grid-cols-[1fr_auto] sm:items-start">
                    <div className="grid gap-1">
                      <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{t.title}</span><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${badge[t.status]}`}>{TOPIC_STATUS_LABEL[t.status]}</span></div>
                      <p className="text-xs text-ink/60">Submitted {when(t.submitted_at)} by {t.submitted_by_name ?? 'the initial proposal list'}</p>
                      {t.status !== 'pending' && <p className="text-xs text-ink/70">{t.status === 'approved' ? 'Approved' : 'Rejected'} by {t.reviewed_by_name ?? 'an administrator'} on {when(t.reviewed_at)}</p>}
                      {t.reviewer_comment && <p className="text-sm text-ink/80">“{t.reviewer_comment}”</p>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {actionsFor(t.status, canReview).map((a) => (
                        <Button key={a} variant={a === 'approve' ? 'accent' : 'quiet'} onClick={() => setDialog({ kind: a, topic: t })}>{a === 'approve' ? 'Approve' : a === 'reject' ? 'Reject' : 'Reconsider'}</Button>
                      ))}
                      <Button variant="quiet" onClick={() => setDialog({ kind: 'details', topic: t })}>View details</Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ))}

      {dialog && dialog.kind === 'details' && <DetailsDialog topic={dialog.topic} onClose={() => setDialog(null)} />}
      {dialog && dialog.kind !== 'details' && (
        <DecisionDialog key={dialog.topic.id + dialog.kind} decision={dialog.kind} topic={dialog.topic} busy={review.isPending}
          onCancel={() => setDialog(null)} onConfirm={(comment) => review.mutate({ id: dialog.topic.id, decision: dialog.kind as TopicDecision, comment })} />
      )}
    </section>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;                       // the latest handler, without re-running the effect below on every render
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('textarea, button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); prev?.focus(); };
  }, []);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-dira-deep/60 p-0 sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="grid max-h-[90vh] w-full max-w-lg gap-4 overflow-y-auto rounded-t-card bg-white p-5 shadow-xl sm:rounded-card">
        <h2 className="font-display text-lg font-semibold text-purple-900">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function DecisionDialog({ decision, topic, busy, onConfirm, onCancel }: { decision: TopicDecision; topic: ProposalRow; busy: boolean; onConfirm: (comment: string) => void; onCancel: () => void }) {
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState(false);
  const error = touched ? validateComment(decision, comment) : null;
  const heading = decision === 'approve' ? 'Approve this topic?' : decision === 'reject' ? 'Reject this topic?' : 'Return this topic to pending?';
  const lead = decision === 'approve' ? 'It becomes official teaching content for this session.' : decision === 'reject' ? 'It will not be taught as official content. It stays in the history and can be reconsidered later.' : 'It will wait for a new decision.';
  const submit = () => { setTouched(true); if (validateComment(decision, comment) === null) onConfirm(comment); };
  return (
    <Modal title={heading} onClose={busy ? () => undefined : onCancel}>
      <p className="text-sm"><strong>{topic.title}</strong><br /><span className="text-ink/70">{topic.track_name ?? 'Shared core'} · Session {topic.session_no}: {topic.session_title}</span></p>
      <p className="text-sm text-ink/80">{lead}</p>
      <label className="grid gap-1 text-sm font-medium">{commentRequired(decision) ? 'Reason (required)' : 'Comment (optional)'}
        <textarea className={`${field} min-h-24`} maxLength={MAX_COMMENT_LENGTH} value={comment} onChange={(e) => setComment(e.target.value)} onBlur={() => setTouched(true)} aria-invalid={!!error} />
      </label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="quiet" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button variant={decision === 'approve' ? 'accent' : 'primary'} disabled={busy} onClick={submit}>
          {busy ? 'Saving…' : decision === 'approve' ? 'Yes, approve' : decision === 'reject' ? 'Yes, reject' : 'Return to pending'}
        </Button>
      </div>
    </Modal>
  );
}

function DetailsDialog({ topic, onClose }: { topic: ProposalRow; onClose: () => void }) {
  const history = useQuery({
    queryKey: ['curriculum-topic-history', topic.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('curriculum_topic_history', { p_id: topic.id });
      if (error) throw error;
      return data as HistoryRow[];
    },
  });
  const rowsInfo: [string, string][] = [
    ['Learning track', topic.track_name ?? 'Shared core'], ['Session', `Week ${topic.week_no} · Session ${topic.session_no}: ${topic.session_title}`], ['Status', TOPIC_STATUS_LABEL[topic.status]],
    ['Submitted', `${when(topic.submitted_at)} by ${topic.submitted_by_name ?? 'the initial proposal list'}`],
    ...(topic.status !== 'pending' ? [['Decision', `${topic.status === 'approved' ? 'Approved' : 'Rejected'} by ${topic.reviewed_by_name ?? 'an administrator'} on ${when(topic.reviewed_at)}`] as [string, string]] : []),
    ['Reviewer comment', topic.reviewer_comment ?? ''],
  ];
  return (
    <Modal title={topic.title} onClose={onClose}>
      <dl className="grid gap-2 text-sm sm:grid-cols-[130px_1fr]">
        {rowsInfo.filter(([, v]) => v).map(([k, v]) => (<div key={k} className="contents"><dt className="font-medium text-ink/70">{k}</dt><dd>{v}</dd></div>))}
      </dl>
      {topic.description && <p className="text-sm">{topic.description}</p>}
      {(topic.session_description || topic.session_objectives?.length) ? (
        <div><h3 className="text-sm font-semibold text-ink/70">About this session</h3>
          {topic.session_description && <p className="mt-1 text-sm">{topic.session_description}</p>}
          {topic.session_objectives?.length ? <ul className="mt-1 list-disc pl-5 text-sm">{topic.session_objectives.map((o, i) => <li key={i}>{o}</li>)}</ul> : null}
        </div>
      ) : null}
      <div>
        <h3 className="text-sm font-semibold text-ink/70">Approval history</h3>
        {history.isLoading ? <p role="status" className="text-sm">Loading…</p> : history.isError ? <p role="alert" className="text-sm text-danger">Could not load the history.</p>
          : !history.data?.length ? <p className="text-sm text-ink/60">No decisions yet.</p>
          : (
            <ol className="mt-1 grid gap-2 text-sm">
              {history.data.map((h) => (
                <li key={h.id} className="border-l-2 border-purple-200 pl-3">
                  <span className="font-medium">{h.from_status ? `${TOPIC_STATUS_LABEL[h.from_status]} → ` : ''}{TOPIC_STATUS_LABEL[h.to_status]}</span>
                  <span className="text-ink/60"> · {new Date(h.created_at).toLocaleString()}{h.actor_name ? ` · ${h.actor_name}` : ''}</span>
                  {h.comment && <p className="whitespace-pre-wrap">{h.comment}</p>}
                </li>
              ))}
            </ol>
          )}
      </div>
      <div className="flex justify-end"><Button variant="quiet" onClick={onClose}>Close</Button></div>
    </Modal>
  );
}
