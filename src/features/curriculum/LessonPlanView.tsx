import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { canReadTeachingNotes, kindLabel, parseLessonPlan, parseTeachingNotes, timeline, timing, type LessonPlanRow, type PlanActivity } from './lessonPlan';

function Block({ title, children }: { title: string; children: ReactNode }) {
  return <div><h4 className="text-sm font-semibold text-purple-900">{title}</h4><div className="mt-1 text-sm">{children}</div></div>;
}
function Items({ items }: { items: string[] }) {
  return <ul className="list-disc pl-5">{items.map((x, i) => <li key={i}>{x}</li>)}</ul>;
}
function Activities({ title, items }: { title: string; items: PlanActivity[] }) {
  if (!items.length) return null;
  return <Block title={title}><ul className="grid gap-1">{items.map((a, i) => <li key={i}><span className="font-medium">{a.title}:</span> {a.instructions}</li>)}</ul></Block>;
}
const staffNote = 'rounded-control border-l-4 border-orange-400 bg-orange-50/60 p-3';

/** The detailed V13 lesson plan of one curriculum session. Learners see topics, outcomes, timings, activities, assessment and homework;
 *  facilitators and programme staff can also show the teaching notes (the database only returns those to them). */
export function LessonPlanView({ sessionId, durationMinutes }: { sessionId: string; durationMinutes: number }) {
  const { profile } = useAuth();
  const staff = profile ? canReadTeachingNotes(profile.role) : false;
  const [hideNotes, setHideNotes] = useState(false);
  const showNotes = staff && !hideNotes;
  const q = useQuery({
    queryKey: ['lesson-plan', sessionId, staff],
    queryFn: async () => {
      const [p, n] = await Promise.all([
        supabase.from('curriculum_lesson_plans').select('session_id, version, status, content, approved_at, updated_at').eq('session_id', sessionId).maybeSingle(),
        staff ? supabase.from('curriculum_teaching_notes').select('content').eq('session_id', sessionId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      ]);
      if (p.error) throw p.error;
      const row = p.data as LessonPlanRow | null;
      return { row, plan: row ? parseLessonPlan(row.content) : null, notes: !n.error && n.data ? parseTeachingNotes((n.data as { content: unknown }).content) : null };
    },
  });
  if (q.isLoading) return <p role="status" className="text-sm">Loading lesson plan…</p>;
  if (q.isError) return <p role="alert" className="text-sm text-danger">Could not load the lesson plan.</p>;
  const { row, plan, notes } = q.data!;
  if (!row || !plan) return <p className="text-sm text-ink/60">No detailed lesson plan for this session yet.</p>;
  const notesOn = showNotes && !!notes;
  const segs = timeline(plan, notesOn ? notes : null);
  const t = timing(plan, durationMinutes);
  const guides = new Map((notes?.assessment_guides ?? []).map((a) => [a.question, a.guide]));
  const f = notes?.facilitator;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 font-semibold ${row.status === 'approved' ? 'bg-ok/10 text-ok' : 'bg-orange-50 text-warn'}`}>
          {row.status === 'approved' ? 'Lesson plan approved' : 'Draft lesson plan: not yet approved by programme management'}
        </span>
        <span className="text-ink/60">{row.version} · {t.message}</span>
        {notes && (
          <label className="ml-auto flex items-center gap-2 font-medium text-purple-800">
            <input type="checkbox" checked={showNotes} onChange={(e) => setHideNotes(!e.target.checked)} /> Show facilitator notes
          </label>
        )}
      </div>
      {!t.matches && <p role="alert" className="text-sm text-danger">{t.message}. Tell the programme coordinator.</p>}

      <Block title="Learning purpose"><p>{plan.purpose}</p></Block>
      {plan.objectives.length > 0 && <Block title="By the end of the session you can"><Items items={plan.objectives} /></Block>}
      {plan.topics.length > 0 && (
        <Block title="Topics">
          <ul className="list-disc pl-5">{plan.topics.map((tp) => <li key={tp.title}><span className="font-medium">{tp.title}</span>{tp.subtopics.length > 0 && <ul className="list-[circle] pl-5 text-ink/80">{tp.subtopics.map((s) => <li key={s}>{s}</li>)}</ul>}</li>)}</ul>
        </Block>
      )}

      <Block title="Session plan and timings">
        <ol className="grid gap-2">
          {segs.map((s, i) => (
            <li key={i} className="rounded-control border border-purple-100 p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{s.title}</span>
                <span className="text-xs text-ink/60">{s.range} · {s.minutes} min · {kindLabel(s.kind)}</span>
              </div>
              {s.summary && <p className="mt-1 text-ink/80">{s.summary}</p>}
              {s.steps.length > 0 && <div className={`mt-2 ${staffNote}`}><p className="text-xs font-semibold text-warn">Facilitator: how to teach it</p><ol className="mt-1 list-decimal pl-5">{s.steps.map((x, j) => <li key={j}>{x}</li>)}</ol></div>}
            </li>
          ))}
        </ol>
      </Block>

      {notesOn && notes.demonstrations.length > 0 && (
        <div className={staffNote}><h4 className="text-sm font-semibold text-purple-900">Practical demonstrations (facilitator)</h4>
          <ul className="mt-1 grid gap-2 text-sm">{notes.demonstrations.map((d) => <li key={d.title}><span className="font-medium">{d.title}</span><ol className="list-decimal pl-5">{d.steps.map((x, j) => <li key={j}>{x}</li>)}</ol></li>)}</ul>
        </div>
      )}
      <Activities title="Guided exercises" items={plan.guided_exercises} />
      <Activities title="Individual activities" items={plan.individual_activities} />
      <Activities title="Group activities" items={plan.group_activities} />
      {plan.examples.length > 0 && <Block title="Real-world examples"><Items items={plan.examples} /></Block>}
      {plan.tools.length > 0 && <Block title="Tools and resources"><Items items={plan.tools} /></Block>}
      {plan.assessment.length > 0 && (
        <Block title="Assessment questions and activities">
          <ul className="list-disc pl-5">{plan.assessment.map((a) => <li key={a.question}>{a.question}{notesOn && guides.get(a.question) && <span className="block text-xs text-warn">Good answer: {guides.get(a.question)}</span>}</li>)}</ul>
        </Block>
      )}
      {plan.expected_outputs.length > 0 && <Block title="What you will produce"><Items items={plan.expected_outputs} /></Block>}
      {plan.homework.length > 0 && <Block title="Homework and follow-up"><Items items={plan.homework} /></Block>}
      {plan.track_project && <Block title="Track final project"><p>{plan.track_project}</p></Block>}
      {plan.cross_track_notes.length > 0 && <Block title="How this differs from other tracks"><Items items={plan.cross_track_notes} /></Block>}
      {notesOn && f && (
        <div className={staffNote}><h4 className="text-sm font-semibold text-purple-900">Facilitator instructions</h4>
          {([['Before the session', f.preparation], ['During the session', f.delivery], ['Inclusion and safeguarding', f.inclusion_and_safeguarding], ['After the session', f.after_session]] as const)
            .filter(([, xs]) => xs && xs.length).map(([h, xs]) => <div key={h} className="mt-2 text-sm"><p className="font-medium">{h}</p><Items items={xs ?? []} /></div>)}
        </div>
      )}
    </div>
  );
}
