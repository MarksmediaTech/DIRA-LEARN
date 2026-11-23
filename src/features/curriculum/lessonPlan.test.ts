import { canApproveLessonPlan, canReadTeachingNotes, clock, kindLabel, parseLessonPlan, parseTeachingNotes, timeline, timing } from './lessonPlan';

const raw = {
  version: 'V13', purpose: 'Learn the customer journey', objectives: ['Explain the journey'], topics: [{ title: 'Channels', subtopics: ['Owned', 'Paid'] }],
  segments: [{ minutes: 10, title: 'Welcome', kind: 'introduction', summary: 'Meet' }, { minutes: 80, title: 'Lesson', kind: 'lesson', summary: 'Learn' }, { minutes: 30, title: 'Wrap-up', kind: 'conclusion', summary: 'Close' }],
  guided_exercises: [{ title: 'Map it', instructions: 'Draw the journey' }], individual_activities: [], group_activities: [{ title: 'Discuss', instructions: 'In threes' }],
  examples: ["Shiru's Bakes in Ruiru"], tools: ['Phone'], assessment: [{ question: 'Name the four stages' }], expected_outputs: ['A channel map'], homework: ['Audit a profile'],
  cross_track_notes: [], track_project: 'A campaign',
};

describe('lesson plans', () => {
  it('reads a stored plan', () => {
    const p = parseLessonPlan(raw)!;
    expect(p.segments).toHaveLength(3);
    expect(p.topics[0]?.subtopics).toEqual(['Owned', 'Paid']);
    expect(p.track_project).toBe('A campaign');
  });
  it('drops malformed parts instead of failing', () => {
    const p = parseLessonPlan({ ...raw, objectives: ['ok', 3, null], segments: [...raw.segments, { minutes: 0, title: 'Bad' }, { minutes: 2.5, title: 'Bad' }, 'x'], tools: 'not a list' })!;
    expect(p.objectives).toEqual(['ok']);
    expect(p.segments).toHaveLength(3);
    expect(p.tools).toEqual([]);
  });
  it('returns null when there is no usable plan', () => {
    expect(parseLessonPlan(null)).toBeNull();
    expect(parseLessonPlan({ purpose: 'x', segments: [] })).toBeNull();
    expect(parseTeachingNotes({})).toBeNull();
  });
  it('adds clock times and teaching steps per segment', () => {
    const notes = parseTeachingNotes({ segments: [{ title: 'Welcome', steps: ['Say hello'] }, { title: 'Lesson', steps: ['Teach', 'Ask'] }] });
    const t = timeline(parseLessonPlan(raw)!, notes);
    expect(t.map((s) => s.range)).toEqual(['0:00–0:10', '0:10–1:30', '1:30–2:00']);
    expect(t[1]?.steps).toEqual(['Teach', 'Ask']);
    expect(t[2]?.steps).toEqual([]);
    expect(timeline(parseLessonPlan(raw)!).every((s) => s.steps.length === 0)).toBe(true);
  });
  it('checks the timetable rule', () => {
    const ok = timing(parseLessonPlan(raw)!, 120);
    expect(ok.total).toBe(120);
    expect(ok.matches).toBe(true);
    expect(timing(parseLessonPlan(raw)!, 115).matches).toBe(false);
    expect(timing(parseLessonPlan(raw)!, 115).message).toContain('115 minutes');
  });
  it('formats times and labels', () => {
    expect(clock(0)).toBe('0:00');
    expect(clock(115)).toBe('1:55');
    expect(kindLabel('exercise')).toBe('Practical exercise');
    expect(kindLabel('break')).toBe('Stretch break');
    expect(kindLabel('unknown')).toBe('Segment');
  });
  it('matches the database rules for who approves and who reads teaching notes', () => {
    expect(canApproveLessonPlan('programme_director')).toBe(true);
    expect(canApproveLessonPlan('programme_coordinator')).toBe(false);
    expect(canReadTeachingNotes('trainer')).toBe(true);
    expect(canReadTeachingNotes('programme_coordinator')).toBe(true);
    for (const r of ['participant', 'applicant', 'mentor', 'me_officer'] as const) expect(canReadTeachingNotes(r)).toBe(false);
  });
});
