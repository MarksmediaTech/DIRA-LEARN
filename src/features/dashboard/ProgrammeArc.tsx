// The four-week arc: the one distinctive element of the participant dashboard.
// Week 1 is shared (purple); Weeks 2-4 follow the chosen track (orange marks the next session to attend).
export interface ArcSession { sessionNo: number; title: string; weekNo: number; state: 'done' | 'next' | 'upcoming' }

export function weekState(sessions: ArcSession[]): 'done' | 'next' | 'upcoming' {
  if (sessions.length > 0 && sessions.every((s) => s.state === 'done')) return 'done';
  if (sessions.some((s) => s.state === 'next')) return 'next';
  return 'upcoming';
}

export function ProgrammeArc({ sessions }: { sessions: ArcSession[] }) {
  const weeks = [1, 2, 3, 4].map((w) => ({ week: w, items: sessions.filter((s) => s.weekNo === w) }));
  return (
    <ol className="grid gap-3 md:grid-cols-4" aria-label="Your four-week programme">
      {weeks.map(({ week, items }) => (
        <li key={week} className={`rounded-card border p-4 ${weekState(items) === 'next' ? 'border-orange-500 bg-orange-50' : weekState(items) === 'done' ? 'border-purple-200 bg-purple-50' : 'border-purple-100'}`}>
          <h3 className="font-semibold">Week {week}</h3>
          <p className="mb-2 text-xs text-ink/60">{week === 1 ? 'Shared core' : 'Your track'}</p>
          {items.length === 0 ? <p className="text-sm text-ink/60">Choose a track to see these sessions.</p> : (
            <ul className="grid gap-1 text-sm">
              {items.map((s) => (
                <li key={s.sessionNo} className={s.state === 'next' ? 'font-semibold' : s.state === 'done' ? 'text-ink/60 line-through' : ''}>
                  {s.title}{s.state === 'next' && <span className="sr-only"> (next)</span>}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
