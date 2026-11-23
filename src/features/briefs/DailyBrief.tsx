import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { useProgrammeTimezone } from '@/features/cohorts/useProgrammeTimezone';
import { useMyAssignments } from '@/features/assignments/useMyAssignments';
import { formatInZone, hourInZone, todayInZone } from '@/lib/timezone';
import { deadlineReminders, greetingFor, pickBrief } from './rules';

interface BriefRow { id: string; cohort_id: string | null; title: string; reflection: string | null; objectives: string[] | null; reflection_question: string | null }
interface SessionRow { id: string; starts_at: string; curriculum_sessions: { session_no: number; title: string } | null }
interface AnnouncementRow { id: string; title: string; body: string; created_at: string }

const heading = 'font-display text-base font-semibold text-purple-900';

/** The learner's Daily Brief. Reflection, objectives and question come only from a published brief; everything else is live programme data. */
export function DailyBrief() {
  const { profile } = useAuth();
  const { tz } = useProgrammeTimezone();
  const today = todayInZone(tz);

  const brief = useQuery({
    queryKey: ['daily-brief', today],
    queryFn: async () => {
      const [b, e] = await Promise.all([
        supabase.from('daily_briefs').select('id, cohort_id, title, reflection, objectives, reflection_question').eq('brief_date', today),
        supabase.from('cohort_enrolments').select('cohort_id'),
      ]);
      if (b.error) throw b.error;
      if (e.error) throw e.error;
      return pickBrief((b.data ?? []) as BriefRow[], ((e.data ?? []) as { cohort_id: string }[]).map((x) => x.cohort_id));
    },
  });
  const sessions = useQuery({
    queryKey: ['daily-brief-sessions'],
    queryFn: async () => {
      const { data, error } = await supabase.from('session_schedules')
        .select('id, starts_at, curriculum_sessions(session_no, title)').in('status', ['scheduled', 'rescheduled'])
        .gte('starts_at', new Date().toISOString()).order('starts_at').limit(3);
      if (error) throw error;
      return (data ?? []) as unknown as SessionRow[];
    },
  });
  const notices = useQuery({
    queryKey: ['daily-brief-announcements'],
    queryFn: async () => {
      const { data, error } = await supabase.from('announcements').select('id, title, body, created_at').order('created_at', { ascending: false }).limit(3);
      if (error) throw error;
      return (data ?? []) as AnnouncementRow[];
    },
  });
  const work = useMyAssignments();
  const reminders = deadlineReminders(work.data ?? []);

  const dateText = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: tz });
  const b = brief.data;
  const objectives = (b?.objectives ?? []).filter(Boolean);

  return (
    <section aria-labelledby="daily-brief-heading" className="grid gap-4 rounded-card border border-purple-100 bg-white p-5">
      <div>
        <h2 id="daily-brief-heading" className="font-display text-xl font-semibold text-purple-900">{greetingFor(hourInZone(tz))}, {profile?.first_name || 'there'}</h2>
        <p className="text-sm text-ink/70">{dateText}</p>
      </div>
      {brief.isError && <p role="alert" className="text-sm text-danger">Could not load today's brief.</p>}
      {b && (
        <div className="grid gap-3">
          <p className="font-semibold">{b.title}</p>
          {b.reflection && <blockquote className="border-l-4 border-dira-orange pl-3 text-ink/80">{b.reflection}</blockquote>}
          {objectives.length > 0 && (<div><h3 className={heading}>Learning objectives for today</h3><ul className="list-disc pl-5 text-sm">{objectives.map((o, i) => <li key={i}>{o}</li>)}</ul></div>)}
          {b.reflection_question && (<div><h3 className={heading}>Reflection question</h3><p className="text-sm">{b.reflection_question}</p></div>)}
        </div>
      )}
      {!b && !brief.isLoading && !brief.isError && <p className="text-sm text-ink/70">There is no brief for today yet.</p>}

      {(sessions.data ?? []).length > 0 && (
        <div>
          <h3 className={heading}>Upcoming sessions</h3>
          <ul className="grid gap-1 text-sm">
            {(sessions.data ?? []).map((s) => <li key={s.id}>{formatInZone(s.starts_at, tz)} · {s.curriculum_sessions ? `Session ${s.curriculum_sessions.session_no}: ${s.curriculum_sessions.title}` : 'Session'}</li>)}
          </ul>
        </div>
      )}

      {reminders.length > 0 && (
        <div>
          <h3 className={heading}>Assignment deadlines</h3>
          <ul className="grid gap-1 text-sm">
            {reminders.slice(0, 4).map((a) => (
              <li key={a.id}><Link to={`/assignments/${a.id}`} className="font-medium text-purple-700 underline">{a.title}</Link> · {a.state === 'overdue' ? <span className="font-semibold text-danger">Overdue, was due {formatInZone(a.dueAt, tz)}</span> : `Due ${formatInZone(a.dueAt, tz)}`}</li>
            ))}
          </ul>
        </div>
      )}

      {(notices.data ?? []).length > 0 && (
        <div>
          <h3 className={heading}>Programme announcements</h3>
          <ul className="grid gap-1 text-sm">
            {(notices.data ?? []).map((n) => <li key={n.id}><span className="font-medium">{n.title}</span><span className="text-ink/70"> · {n.body.length > 120 ? `${n.body.slice(0, 120)}…` : n.body}</span></li>)}
          </ul>
          <Link to="/announcements" className="text-sm font-medium text-purple-700 underline">All announcements</Link>
        </div>
      )}
    </section>
  );
}
