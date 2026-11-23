import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import type { Certificate, GraduationRule } from '@/types/database';
import { isAssignedTo, recipientMap } from '@/features/assignments/rules';
import { evaluateEligibility, publicVerifyUrl, type CompletionFigures } from './rules';

interface Person { first_name: string; last_name: string }
interface CertRow extends Certificate { participants: { participant_no: string; profiles: Person | null } | null; cohorts: { name: string } | null }
const nameOf = (p: Person | null | undefined) => (p ? `${p.first_name} ${p.last_name}`.trim() || 'Unnamed' : 'Unnamed');

export function CertificatesPage() {
  const { profile } = useAuth();
  if (!profile) return null;
  return profile.role === 'participant' ? <MyCertificates /> : <StaffCertificates canIssue={['super_admin', 'founder', 'co_founder', 'programme_director'].includes(profile.role)} />;
}

// ---------- participant ----------
function MyCertificates() {
  const q = useQuery({
    queryKey: ['my-certificates'],
    queryFn: async () => {
      const { data, error } = await supabase.from('certificates').select('id, participant_id, cohort_id, certificate_no, issued_on, revoked, revoked_reason, participants(participant_no, profiles(first_name, last_name)), cohorts(name)').order('issued_on', { ascending: false });
      if (error) throw error;
      return data as unknown as CertRow[];
    },
  });
  if (q.isLoading) return <p role="status">Loading…</p>;
  if (q.isError) return <p role="alert" className="text-danger">Could not load your certificates.</p>;
  if (!q.data?.length) return <EmptyState title="No certificate yet">Your certificate appears here after you complete the programme and the team issues it.</EmptyState>;
  return (
    <section className="grid max-w-3xl gap-6">
      <h1 className="text-2xl font-bold text-purple-700 print:hidden">My certificates</h1>
      {q.data.map((c) => <CertificateCard key={c.id} cert={c} />)}
    </section>
  );
}

function CertificateCard({ cert }: { cert: CertRow }) {
  return (
    <article className="grid gap-3 rounded-card border-2 border-purple-600 p-8 text-center print:border-purple-900">
      <p className="font-display text-sm uppercase tracking-widest text-purple-700">DIRA Foundation</p>
      <h2 className="font-display text-3xl font-bold text-purple-900">Certificate of Completion</h2>
      <p>This certifies that</p>
      <p className="font-display text-2xl font-bold">{nameOf(cert.participants?.profiles)}</p>
      <p>completed the DIRA LEARN programme{cert.cohorts ? ` (${cert.cohorts.name})` : ''}.</p>
      <p className="text-sm text-ink/70">Issued on {cert.issued_on} · Certificate number {cert.certificate_no}</p>
      <p className="text-xs text-ink/60">Verify at {publicVerifyUrl(window.location.origin, cert.certificate_no)}</p>
      {cert.revoked && <p role="alert" className="font-semibold text-danger">This certificate has been withdrawn{cert.revoked_reason ? `: ${cert.revoked_reason}` : '.'}</p>}
      {!cert.revoked && <Button type="button" className="justify-self-center print:hidden" onClick={() => window.print()}>Print or save as PDF</Button>}
    </article>
  );
}

// ---------- staff ----------
function StaffCertificates({ canIssue }: { canIssue: boolean }) {
  const qc = useQueryClient();
  const [cohortId, setCohortId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const cohorts = useQuery({
    queryKey: ['cert-cohorts'],
    queryFn: async () => { const { data, error: e } = await supabase.from('cohorts').select('id, name, programme_id').order('start_date', { ascending: false }); if (e) throw e; return data as { id: string; name: string; programme_id: string }[]; },
  });
  useEffect(() => { if (!cohortId && cohorts.data?.length) setCohortId(cohorts.data[0]!.id); }, [cohorts.data, cohortId]);
  const cohort = cohorts.data?.find((c) => c.id === cohortId);

  const rule = useQuery({
    queryKey: ['cert-rule', cohort?.programme_id],
    enabled: Boolean(cohort),
    queryFn: async () => { const { data, error: e } = await supabase.from('graduation_rules').select('id, programme_id, min_sessions_attended, require_core_sessions, require_final_project, require_reflection, is_approved, approved_at').eq('programme_id', cohort!.programme_id).maybeSingle(); if (e) throw e; return data as GraduationRule | null; },
  });

  const data = useQuery({
    queryKey: ['cert-data', cohortId],
    enabled: Boolean(cohortId),
    queryFn: async () => {
      const [e, c, s, asg] = await Promise.all([
        supabase.from('cohort_enrolments').select('participant_id, track_id, participants(participant_no, status, profiles(first_name, last_name))').eq('cohort_id', cohortId),
        supabase.from('certificates').select('id, participant_id, cohort_id, certificate_no, issued_on, revoked, revoked_reason').eq('cohort_id', cohortId).order('issued_on', { ascending: false }),
        supabase.from('session_schedules').select('id, curriculum_session_id, status, curriculum_sessions(track_id)').eq('cohort_id', cohortId),
        supabase.from('assignments').select('id, track_id, component').eq('cohort_id', cohortId),
      ]);
      for (const r of [e, c, s, asg]) if (r.error) throw r.error;
      const schedIds = (s.data ?? []).map((x) => x.id); const asgIds = (asg.data ?? []).map((x) => x.id);
      const [att, sub, rec] = await Promise.all([
        schedIds.length ? supabase.from('attendance').select('schedule_id, participant_id, status').in('schedule_id', schedIds) : Promise.resolve({ data: [], error: null }),
        asgIds.length ? supabase.from('submissions').select('assignment_id, participant_id').in('assignment_id', asgIds) : Promise.resolve({ data: [], error: null }),
        asgIds.length ? supabase.from('assignment_recipients').select('assignment_id, participant_id').in('assignment_id', asgIds) : Promise.resolve({ data: [], error: null }),
      ]);
      if (att.error) throw att.error; if (sub.error) throw sub.error; if (rec.error) throw rec.error;
      return { enrols: e.data as unknown as { participant_id: string; track_id: string | null; participants: { participant_no: string; status: string; profiles: Person | null } | null }[],
        certs: c.data as Certificate[], schedules: s.data as unknown as { id: string; curriculum_session_id: string; status: string; curriculum_sessions: { track_id: string | null } | null }[],
        assignments: asg.data as { id: string; track_id: string | null; component: string }[], attendance: att.data as { schedule_id: string; participant_id: string; status: string }[],
        submissions: sub.data as { assignment_id: string; participant_id: string }[],
        recipients: recipientMap((rec.data ?? []) as { assignment_id: string; participant_id: string }[]) };
    },
  });

  const rows = useMemo(() => {
    const d = data.data; if (!d) return [];
    const live = d.schedules.filter((x) => x.status !== 'cancelled');
    const coreTotal = new Set(live.filter((x) => x.curriculum_sessions?.track_id == null).map((x) => x.curriculum_session_id)).size;
    return d.enrols.map((en) => {
      const mine = live.filter((x) => x.curriculum_sessions?.track_id == null || x.curriculum_sessions.track_id === en.track_id);
      const byId = new Map(mine.map((x) => [x.id, x]));
      const attended = new Map<string, boolean>();
      for (const a of d.attendance) {
        const sc = byId.get(a.schedule_id);
        if (a.participant_id === en.participant_id && sc && (a.status === 'present' || a.status === 'late')) attended.set(sc.curriculum_session_id, sc.curriculum_sessions?.track_id == null);
      }
      const submitted = (comp: string) => d.assignments.filter((x) => x.component === comp && (x.track_id === null || x.track_id === en.track_id) && isAssignedTo(x.id, en.participant_id, d.recipients)).some((x) => d.submissions.some((s) => s.assignment_id === x.id && s.participant_id === en.participant_id));
      const figures: CompletionFigures = { sessionsAttended: attended.size, coreAttended: [...attended.values()].filter(Boolean).length, coreTotal, finalSubmitted: submitted('final_project'), reflectionSubmitted: submitted('reflection') };
      const cert = d.certs.find((c) => c.participant_id === en.participant_id && !c.revoked) ?? null;
      return { id: en.participant_id, no: en.participants?.participant_no ?? '', status: en.participants?.status ?? '', name: nameOf(en.participants?.profiles), elig: evaluateEligibility(rule.data ?? null, figures), cert };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [data.data, rule.data]);

  const refresh = () => { void qc.invalidateQueries({ queryKey: ['cert-data'] }); };
  const issue = useMutation({
    mutationFn: async (participantId: string) => { const { error: e } = await supabase.rpc('issue_certificate', { p_participant: participantId, p_cohort: cohortId }); if (e) throw e; },
    onSuccess: () => { setError(null); refresh(); }, onError: (e: Error) => setError(e.message),
  });
  const revoke = useMutation({
    mutationFn: async (v: { id: string; reason: string }) => { const { error: e } = await supabase.rpc('revoke_certificate', { p_certificate: v.id, p_reason: v.reason }); if (e) throw e; },
    onSuccess: () => { setError(null); refresh(); }, onError: (e: Error) => setError(e.message),
  });
  const alumni = useMutation({
    mutationFn: async (participantId: string) => { const { error: e } = await supabase.rpc('mark_alumni', { p_participant: participantId }); if (e) throw e; },
    onSuccess: () => { setError(null); refresh(); }, onError: (e: Error) => setError(e.message),
  });

  if (cohorts.isLoading) return <p role="status">Loading…</p>;
  if (cohorts.isError) return <p role="alert" className="text-danger">Could not load cohorts.</p>;
  if (!cohorts.data?.length) return <EmptyState title="No cohorts yet">Certificates are issued per cohort once it has run.</EmptyState>;

  return (
    <section className="grid max-w-5xl gap-5">
      <h1 className="text-2xl font-bold text-purple-700">Certificates and graduation</h1>
      {rule.data?.is_approved
        ? <p className="rounded-card border border-purple-100 bg-purple-50 p-3 text-sm">Graduation rules approved{rule.data.approved_at ? ` on ${rule.data.approved_at.slice(0, 10)}` : ''}. The database checks them again when a certificate is issued.</p>
        : <p role="alert" className="rounded-card border border-amber-300 bg-amber-50 p-3 text-sm"><strong>No certificate can be issued yet.</strong> Management has not approved graduation rules for this programme. A super administrator approves them under Settings.</p>}
      <label className="grid max-w-xs gap-1 text-sm font-medium">Cohort
        <select value={cohortId} onChange={(e) => setCohortId(e.target.value)} className="rounded-control border border-purple-200 px-3 py-2 font-normal">{cohorts.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {data.isLoading && <p role="status">Loading…</p>}
      {data.isError && <p role="alert" className="text-danger">Could not load this cohort.</p>}
      {data.data && !rows.length && <EmptyState title="No participants">Nobody is enrolled in this cohort.</EmptyState>}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm"><caption className="sr-only">Graduation readiness and certificates</caption>
            <thead><tr className="border-b border-purple-200"><th scope="col" className="p-2">Participant</th><th scope="col" className="p-2">Requirements</th><th scope="col" className="p-2">Certificate</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="border-b border-purple-100 align-top">
                <th scope="row" className="p-2 font-medium">{r.name}<div className="text-xs font-normal text-ink/60">{r.no} · {r.status}</div></th>
                <td className="p-2">
                  {r.elig.blockedBy ? <span className="text-ink/70">Waiting for approved rules</span> : (
                    <ul>{r.elig.checks.map((k) => <li key={k.key}><span aria-hidden>{k.ok ? '✓' : '○'}</span> <span className="sr-only">{k.ok ? 'Met: ' : 'Not met: '}</span>{k.label}</li>)}</ul>)}
                </td>
                <td className="p-2">
                  {r.cert ? (
                    <div className="grid gap-1"><span>{r.cert.certificate_no}<span className="block text-xs text-ink/60">Issued {r.cert.issued_on}</span></span>
                      {canIssue && <Button variant="quiet" type="button" onClick={() => { const reason = window.prompt('Why is this certificate being withdrawn? (required)'); if (reason) revoke.mutate({ id: r.cert!.id, reason }); }}>Withdraw</Button>}
                      {r.status === 'graduated' && <Button variant="quiet" type="button" onClick={() => alumni.mutate(r.id)}>Move to alumni</Button>}
                    </div>
                  ) : canIssue
                    ? <Button type="button" disabled={!r.elig.eligible || issue.isPending} onClick={() => issue.mutate(r.id)}>Issue certificate</Button>
                    : <span className="text-ink/60">Not issued</span>}
                </td>
              </tr>))}</tbody>
          </table>
          {!canIssue && <p className="mt-2 text-xs text-ink/60">Only a super administrator or programme director can issue or withdraw certificates.</p>}
        </div>
      )}
    </section>
  );
}
