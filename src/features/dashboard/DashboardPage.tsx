import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { EmptyState } from '@/components/ui/EmptyState';
import { Link } from 'react-router-dom';
import { CURRICULUM_APPROVERS, isStaffRole, navFor } from '@/lib/permissions';
import { ROLE_LABEL } from '@/features/admin/rules';
import { CoverHero } from './CoverHero';
import { ProgrammeArc, type ArcSession } from './ProgrammeArc';
import { AccessBanner } from './AccessBanner';
import { MyAssignmentsCard } from '@/features/assignments/MyAssignmentsCard';
import { DailyBrief } from '@/features/briefs/DailyBrief';
import { PENDING_STATUSES } from '@/features/applications/workflow';
import type { ApplicationStatus } from '@/types/database';
import { pct, type LearnerMetrics } from '@/features/performance/rules';
import { attentionItems, attentionSources, type AttentionCounts } from './attention';

interface ScheduleWithSession { status: string; starts_at: string; curriculum_sessions: { session_no: number; week_no: number; title: string } | null }

function ParticipantDashboard() {
  const q = useQuery({
    queryKey: ['participant-arc'],
    queryFn: async () => {
      const { data, error } = await supabase.from('session_schedules')
        .select('status, starts_at, curriculum_sessions(session_no, week_no, title)').order('starts_at');
      if (error) throw error;
      const rows = (data as unknown as ScheduleWithSession[]).filter((r) => r.curriculum_sessions);
      const nextIdx = rows.findIndex((r) => r.status === 'scheduled');
      return rows.map<ArcSession>((r, i) => ({
        sessionNo: r.curriculum_sessions!.session_no, weekNo: r.curriculum_sessions!.week_no, title: r.curriculum_sessions!.title,
        state: r.status === 'completed' ? 'done' : i === nextIdx ? 'next' : 'upcoming',
      }));
    },
  });
  if (q.isLoading) return <p role="status">Loading your programme…</p>;
  if (q.isError) return <p role="alert" className="text-danger">Could not load your programme.</p>;
  if (!q.data?.length) return <EmptyState title="Your timetable is empty">Sessions appear here once your cohort is scheduled.</EmptyState>;
  return <ProgrammeArc sessions={q.data} />;
}

function StaffDashboard() {
  const q = useQuery({
    queryKey: ['application-funnel'],
    queryFn: async () => {
      const { data, error } = await supabase.from('v_application_funnel').select('status, total');
      if (error) throw error;
      return data as { status: string; total: number }[];
    },
  });
  if (q.isLoading) return <p role="status">Loading…</p>;
  if (q.isError) return <p role="alert" className="text-danger">Could not load application figures.</p>;
  if (!q.data?.length) return <EmptyState title="No applications yet">Figures appear here when applicants start submitting.</EmptyState>;
  const waiting = q.data.filter((r) => PENDING_STATUSES.includes(r.status as ApplicationStatus)).reduce((n, r) => n + r.total, 0);
  return (
    <div className="grid gap-4">
      {waiting > 0 && (
        <Link to="/applications" className="flex max-w-xl items-center justify-between rounded-card border border-dira-orange bg-orange-50 p-4 text-sm font-semibold text-dira-deep hover:border-orange-600">
          <span>{waiting} {waiting === 1 ? 'application is' : 'applications are'} waiting for a decision</span><span aria-hidden>Review →</span>
        </Link>
      )}
    <dl className="grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-4">
      {q.data.map((r) => (
        <div key={r.status} className="rounded-card border border-purple-100 p-4">
          <dt className="text-sm capitalize text-ink/70">{r.status.replace('_', ' ')}</dt><dd className="font-display text-2xl font-bold">{r.total}</dd>
        </div>
      ))}
    </dl>
    </div>
  );
}

function TopicApprovalBanner() {
  const q = useQuery({
    queryKey: ['curriculum-pending-count'],
    queryFn: async () => {
      const { count, error } = await supabase.from('curriculum_topic_proposals').select('id', { count: 'exact', head: true }).eq('status', 'pending');
      if (error) throw error;
      return count ?? 0;
    },
  });
  if (!q.data) return null;
  return (
    <Link to="/curriculum/approval" className="flex max-w-xl items-center justify-between rounded-card border border-dira-orange bg-orange-50 p-4 text-sm font-semibold text-dira-deep hover:border-orange-600">
      <span>{q.data} curriculum {q.data === 1 ? 'topic is' : 'topics are'} waiting for approval</span><span aria-hidden>Review →</span>
    </Link>
  );
}

/** Phase 9: what needs this person's attention, from figures the database already limits to what they may see. */
function AttentionPanel({ role }: { role: string }) {
  const position = useQuery({ queryKey: ['sg-me-position'], queryFn: async () => { const { data } = await supabase.rpc('sg_my_position'); return (data as string | null) ?? null; } });
  const sources = attentionSources(role, Boolean(position.data));
  const q = useQuery({
    queryKey: ['attention', role, sources.join(',')], enabled: !position.isLoading && sources.length > 0, staleTime: 300_000,
    queryFn: async (): Promise<AttentionCounts> => {
      const c: AttentionCounts = {};
      const rows = async <T,>(fn: string, args?: Record<string, unknown>): Promise<T[]> => { const { data, error } = await supabase.rpc(fn, args); if (error) throw error; return (data ?? []) as T[]; };
      if (sources.includes('gradingWaiting')) c.gradingWaiting = (await rows<{ awaiting_grading: number }>('ci_facilitators')).reduce((n, r) => n + r.awaiting_grading, 0);
      if (sources.includes('learnersNeedingSupport')) {
        if (role === 'trainer') {
          const cohorts = await rows<{ id: string }>('performance_cohorts');
          const lists = await Promise.all(cohorts.map((co) => rows<LearnerMetrics>('learner_metrics', { p_cohort: co.id })));
          c.learnersNeedingSupport = lists.flat().filter((m) => m.needs_support).length;
        } else {
          c.learnersNeedingSupport = (await rows<{ level: string; needs_support: number }>('ci_cohort_comparison')).filter((r) => r.level === 'cohort').reduce((n, r) => n + r.needs_support, 0);
        }
      }
      if (sources.includes('reportsOpen')) c.reportsOpen = (await rows<unknown>('connect_list_reports', { p_status: 'open' })).length;
      if (sources.includes('filesWaitingScan')) { const r = (await rows<{ pending: number; scanning: number }>('connect_scan_queue'))[0]; c.filesWaitingScan = r ? r.pending + r.scanning : 0; }
      if (sources.includes('concernsWithoutOfficer')) { const { data } = await supabase.rpc('sg_waiting_without_officer'); c.concernsWithoutOfficer = Number(data ?? 0); }
      if (sources.includes('safeguardingOpen')) {
        const sg = await rows<{ open_count: number; overdue_ack: number }>('ci_safeguarding_summary');
        c.safeguardingOpen = sg.reduce((n, r) => n + r.open_count, 0); c.safeguardingOverdue = sg.reduce((n, r) => n + r.overdue_ack, 0);
      }
      return c;
    },
  });
  const items = attentionItems(q.data ?? {});
  if (sources.length === 0 || items.length === 0) return null;
  return (
    <section aria-labelledby="attention-heading" className="grid max-w-2xl gap-2">
      <h2 id="attention-heading" className="font-display text-lg font-semibold text-dira-deep">Needs your attention</h2>
      <ul className="grid gap-2">
        {items.map((i) => (
          <li key={i.key}>
            <Link to={i.to} className={`flex items-center justify-between gap-3 rounded-card border p-3 text-sm font-semibold text-dira-deep hover:border-orange-600 ${i.urgent ? 'border-danger bg-red-50' : 'border-dira-orange bg-orange-50'}`}>
              <span>{i.text}</span><span aria-hidden>Open →</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function MyPerformanceCard() {
  const q = useQuery({
    queryKey: ['my-performance'],
    queryFn: async () => { const { data, error } = await supabase.rpc('my_performance'); if (error) throw error; return (data ?? []) as { cohort_id: string; cohort_name: string; metrics: LearnerMetrics }[]; },
  });
  const first = q.data?.[0];
  if (!first) return null;
  const m = first.metrics;
  return (
    <Link to="/performance" className="grid max-w-2xl gap-1 rounded-card border border-purple-100 bg-white p-4 text-sm shadow-sm hover:border-dira-orange">
      <span className="font-display text-lg font-semibold text-dira-deep">My performance</span>
      <span>Attendance {pct(m.attendance_rate)} · {m.submitted} of {m.assignments_expected} pieces of work submitted{m.overdue ? ` · ${m.overdue} overdue` : ''} · overall {pct(m.overall)} (draft)</span>
    </Link>
  );
}

export function DashboardPage() {
  const { profile } = useAuth();
  if (!profile) return null;
  const links = navFor(profile.role).filter((i) => i.path !== '/');
  return (
    <section className="grid gap-6">
      <CoverHero name={profile.first_name} roleLabel={ROLE_LABEL[profile.role]} />
      {profile.role === 'participant' && <AccessBanner />}
      {profile.role === 'participant' && <DailyBrief />}
      {profile.role === 'participant' && <MyAssignmentsCard />}
      {profile.role === 'participant' && <MyPerformanceCard />}
      {profile.role === 'participant' && <ParticipantDashboard />}
      <AttentionPanel role={profile.role} />
      {CURRICULUM_APPROVERS.includes(profile.role) && <TopicApprovalBanner />}
      {isStaffRole(profile.role) && <StaffDashboard />}
      {links.length > 0 && (
        <nav aria-label="Quick links">
          <h2 className="mb-3 font-display text-lg font-semibold text-dira-deep">Go to</h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {links.map((i) => (
              <li key={i.path}><Link to={i.path} className="block rounded-card border border-purple-100 bg-white p-4 text-sm font-semibold text-dira-deep shadow-sm transition hover:-translate-y-0.5 hover:border-dira-orange hover:shadow-md">{i.label}<span aria-hidden className="ml-1 text-dira-orange">&rarr;</span></Link></li>
            ))}
          </ul>
        </nav>
      )}
    </section>
  );
}
