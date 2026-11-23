import type { RoleCode } from '@/types/database';

// Shapes stored by migration 30 (curriculum_lesson_plans.content and curriculum_teaching_notes.content).
export type SegmentKind = 'introduction' | 'lesson' | 'demonstration' | 'exercise' | 'group' | 'assessment' | 'conclusion' | 'break';
export interface PlanSegment { minutes: number; title: string; kind: SegmentKind | string; summary: string }
export interface PlanTopic { title: string; subtopics: string[] }
export interface PlanActivity { title: string; instructions: string }
export interface LessonPlanContent {
  version: string; purpose: string; objectives: string[]; topics: PlanTopic[]; segments: PlanSegment[];
  guided_exercises: PlanActivity[]; individual_activities: PlanActivity[]; group_activities: PlanActivity[];
  examples: string[]; tools: string[]; assessment: { question: string }[]; expected_outputs: string[]; homework: string[];
  cross_track_notes: string[]; track_project?: string;
}
export interface TeachingNotesContent {
  version: string; segments: { title: string; steps: string[] }[]; demonstrations: { title: string; steps: string[] }[];
  assessment_guides: { question: string; guide: string }[];
  facilitator: { preparation?: string[]; delivery?: string[]; inclusion_and_safeguarding?: string[]; after_session?: string[] };
}
export interface LessonPlanRow { session_id: string; version: string; status: 'draft' | 'approved'; content: unknown; approved_at: string | null; updated_at: string }

export const KIND_LABELS: Record<SegmentKind, string> = {
  introduction: 'Introduction and recap', lesson: 'Main lesson', demonstration: 'Demonstration', exercise: 'Practical exercise',
  group: 'Group activity', assessment: 'Assessment and feedback', conclusion: 'Conclusion and assignment', break: 'Stretch break',
};
export const kindLabel = (k: string): string => (KIND_LABELS as Record<string, string>)[k] ?? 'Segment';

// Must match the database: can_approve_lesson_plans() and can_read_teaching_notes() in migration 30.
export const canApproveLessonPlan = (r: RoleCode) => r === 'super_admin' || r === 'founder' || r === 'co_founder' || r === 'programme_director';
export const canReadTeachingNotes = (r: RoleCode) => canApproveLessonPlan(r) || r === 'programme_coordinator' || r === 'trainer';

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = <T>(v: unknown, f: (o: Record<string, unknown>) => T | null): T[] => (Array.isArray(v) ? v.map((x) => f(obj(x))).filter((x): x is T => x !== null) : []);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const activity = (o: Record<string, unknown>): PlanActivity | null => (str(o.title) ? { title: str(o.title), instructions: str(o.instructions) } : null);

/** Reads stored content defensively: anything malformed is dropped rather than breaking the page. Returns null if there is no usable plan. */
export function parseLessonPlan(raw: unknown): LessonPlanContent | null {
  const o = obj(raw);
  const segments = list(o.segments, (s) => (typeof s.minutes === 'number' && Number.isInteger(s.minutes) && s.minutes > 0 && str(s.title)
    ? { minutes: s.minutes, title: str(s.title), kind: str(s.kind), summary: str(s.summary) } : null));
  if (!segments.length) return null;
  return {
    version: str(o.version), purpose: str(o.purpose), objectives: strs(o.objectives),
    topics: list(o.topics, (t) => (str(t.title) ? { title: str(t.title), subtopics: strs(t.subtopics) } : null)), segments,
    guided_exercises: list(o.guided_exercises, activity), individual_activities: list(o.individual_activities, activity), group_activities: list(o.group_activities, activity),
    examples: strs(o.examples), tools: strs(o.tools), assessment: list(o.assessment, (a) => (str(a.question) ? { question: str(a.question) } : null)),
    expected_outputs: strs(o.expected_outputs), homework: strs(o.homework), cross_track_notes: strs(o.cross_track_notes),
    ...(str(o.track_project) ? { track_project: str(o.track_project) } : {}),
  };
}
export function parseTeachingNotes(raw: unknown): TeachingNotesContent | null {
  const o = obj(raw);
  if (!Array.isArray(o.segments)) return null;
  const f = obj(o.facilitator);
  return {
    version: str(o.version), segments: list(o.segments, (s) => ({ title: str(s.title), steps: strs(s.steps) })),
    demonstrations: list(o.demonstrations, (d) => (str(d.title) ? { title: str(d.title), steps: strs(d.steps) } : null)),
    assessment_guides: list(o.assessment_guides, (a) => (str(a.question) ? { question: str(a.question), guide: str(a.guide) } : null)),
    facilitator: { preparation: strs(f.preparation), delivery: strs(f.delivery), inclusion_and_safeguarding: strs(f.inclusion_and_safeguarding), after_session: strs(f.after_session) },
  };
}

export const clock = (m: number): string => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
export interface TimedSegment extends PlanSegment { start: number; end: number; range: string; steps: string[] }
/** Adds running clock times (0:00–0:10 …) and, when teaching notes are available, the step-by-step teaching content of each segment. */
export function timeline(plan: LessonPlanContent, notes?: TeachingNotesContent | null): TimedSegment[] {
  let t = 0;
  return plan.segments.map((s, i) => {
    const start = t; t += s.minutes;
    return { ...s, start, end: t, range: `${clock(start)}–${clock(t)}`, steps: notes?.segments[i]?.steps ?? [] };
  });
}
/** The timetable rule, as the database enforces it: the segments add up exactly to the session's duration. */
export function timing(plan: LessonPlanContent, durationMinutes: number): { total: number; matches: boolean; message: string } {
  const total = plan.segments.reduce((n, s) => n + s.minutes, 0);
  const matches = total === durationMinutes;
  return { total, matches, message: matches ? `${total} minutes in ${plan.segments.length} segments, matching the ${durationMinutes}-minute session` : `Segments add up to ${total} minutes but the session is ${durationMinutes} minutes` };
}
