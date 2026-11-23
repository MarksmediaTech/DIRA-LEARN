import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/features/auth/AuthProvider';
import { canAccess } from '@/lib/permissions';
import { GoogleSyncPanel } from './GoogleSyncPanel';
import { addDays, canJoin, itemsOn, monthGrid, sameDay, shift, startOfDay, startOfWeek, toIcs, visibleRange, type CalendarItem, type View } from './rules';

interface SessionRow { id: string; starts_at: string; ends_at: string; status: string; mode: string; venue: string | null; meeting_url: string | null; curriculum_sessions: { title: string } | null; cohorts: { name: string } | null }
interface AssignRow { id: string; title: string; due_at: string; cohorts: { name: string } | null }
interface CohortRow { id: string; name: string; start_date: string; end_date: string }
const KIND_STYLE: Record<CalendarItem['kind'], string> = {
  session: 'bg-purple-100 text-purple-900', assignment: 'bg-orange-100 text-orange-900', cohort_start: 'bg-green-100 text-ok', cohort_end: 'bg-slate-100 text-ink',
};
const KIND_LABEL: Record<CalendarItem['kind'], string> = { session: 'Session', assignment: 'Deadline', cohort_start: 'Cohort starts', cohort_end: 'Cohort ends' };
const localDate = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y!, m! - 1, d!); };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const time = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function CalendarPage() {
  const { profile } = useAuth();
  const canOpenSession = profile ? canAccess(profile.role, '/sessions') : false;
  const [view, setView] = useState<View>('month');
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const range = visibleRange(view, anchor);
  const key = `${iso(range.from)}_${iso(range.to)}`;

  const q = useQuery({
    queryKey: ['calendar', key],
    queryFn: async (): Promise<CalendarItem[]> => {
      const [s, a, c] = await Promise.all([
        supabase.from('session_schedules').select('id, starts_at, ends_at, status, mode, venue, meeting_url, curriculum_sessions(title), cohorts(name)').gte('starts_at', range.from.toISOString()).lt('starts_at', range.to.toISOString()),
        supabase.from('assignments').select('id, title, due_at, cohorts(name)').gte('due_at', range.from.toISOString()).lt('due_at', range.to.toISOString()),
        supabase.from('cohorts').select('id, name, start_date, end_date').or(`and(start_date.gte.${iso(range.from)},start_date.lt.${iso(range.to)}),and(end_date.gte.${iso(range.from)},end_date.lt.${iso(range.to)})`),
      ]);
      for (const r of [s, a, c]) if (r.error) throw r.error;
      const items: CalendarItem[] = [];
      for (const x of s.data as unknown as SessionRow[]) items.push({ id: x.id, kind: 'session', title: x.curriculum_sessions?.title ?? 'Session', start: new Date(x.starts_at), end: new Date(x.ends_at), allDay: false,
        detail: [x.cohorts?.name, x.mode, x.venue].filter(Boolean).join(' · '), mode: x.mode, url: x.meeting_url, cancelled: x.status === 'cancelled' });
      for (const x of a.data as unknown as AssignRow[]) items.push({ id: x.id, kind: 'assignment', title: `Due: ${x.title}`, start: new Date(x.due_at), end: null, allDay: false, detail: x.cohorts?.name });
      for (const x of c.data as unknown as CohortRow[]) {
        const st = localDate(x.start_date), en = localDate(x.end_date);
        if (st >= range.from && st < range.to) items.push({ id: `${x.id}-s`, kind: 'cohort_start', title: `${x.name} starts`, start: st, end: null, allDay: true });
        if (en >= range.from && en < range.to) items.push({ id: `${x.id}-e`, kind: 'cohort_end', title: `${x.name} ends`, start: en, end: null, allDay: true });
      }
      return items;
    },
  });
  const items = q.data ?? [];
  const now = new Date();
  const title = view === 'month' ? anchor.toLocaleDateString([], { month: 'long', year: 'numeric' })
    : view === 'week' ? `Week of ${startOfWeek(anchor).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' })}`
    : anchor.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const download = () => {
    const blob = new Blob([toIcs(items, new Date())], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `dira-learn-${iso(range.from)}.ics`; a.click(); URL.revokeObjectURL(url);
  };
  const days = useMemo(() => (view === 'day' ? [anchor] : view === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i)) : []), [view, anchor]);

  return (
    <section className="grid max-w-6xl gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-purple-700">Calendar</h1>
        <div role="group" aria-label="Calendar view" className="flex gap-1">
          {(['day', 'week', 'month'] as View[]).map((v) => <Button key={v} type="button" variant={view === v ? 'primary' : 'quiet'} aria-pressed={view === v} onClick={() => setView(v)} className="capitalize">{v}</Button>)}
        </div>
      </div>
      {profile && <GoogleSyncPanel role={profile.role} />}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="quiet" onClick={() => setAnchor(shift(view, anchor, -1))} aria-label="Previous">‹</Button>
        <Button type="button" variant="quiet" onClick={() => setAnchor(startOfDay(new Date()))}>Today</Button>
        <Button type="button" variant="quiet" onClick={() => setAnchor(shift(view, anchor, 1))} aria-label="Next">›</Button>
        <h2 className="font-display text-lg font-semibold" aria-live="polite">{title}</h2>
        <Button type="button" variant="quiet" className="ml-auto" disabled={!items.length} onClick={download}>Download .ics</Button>
      </div>
      <p className="text-xs text-ink/60">Shows the sessions, deadlines and cohort dates you are allowed to see. The .ics file imports into Google Calendar or Outlook; automatic two-way sync is not set up.</p>
      {q.isLoading && <p role="status">Loading…</p>}
      {q.isError && <p role="alert" className="text-danger">Could not load the calendar.</p>}

      {view === 'month' && (
        <div className="overflow-x-auto"><div className="min-w-[640px]">
          <div className="grid grid-cols-7 text-center text-xs font-semibold text-ink/70">{['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="p-2">{d}</div>)}</div>
          {monthGrid(anchor).map((week, wi) => (
            <div key={wi} className="grid grid-cols-7">
              {week.map((d) => {
                const its = itemsOn(items, d); const out = d.getMonth() !== anchor.getMonth();
                return (
                  <div key={d.toISOString()} className={`min-h-24 border border-purple-100 p-1 ${out ? 'bg-slate-50 text-ink/40' : ''}`}>
                    <button type="button" onClick={() => { setAnchor(d); setView('day'); }} className={`mb-1 grid h-6 w-6 place-items-center rounded-full text-xs ${sameDay(d, now) ? 'bg-purple-700 font-bold text-white' : ''}`} aria-label={d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}>{d.getDate()}</button>
                    {its.slice(0, 3).map((i) => <p key={i.id} className={`mb-0.5 truncate rounded px-1 text-xs ${KIND_STYLE[i.kind]} ${i.cancelled ? 'line-through opacity-60' : ''}`} title={i.title}>{i.title}</p>)}
                    {its.length > 3 && <p className="text-xs text-ink/60">+{its.length - 3} more</p>}
                  </div>
                );
              })}
            </div>
          ))}
        </div></div>
      )}

      {view !== 'month' && (
        <div className="grid gap-4">
          {days.map((d) => {
            const its = itemsOn(items, d);
            return (
              <div key={d.toISOString()} className="rounded-card border border-purple-100 p-3">
                <h3 className={`font-display text-base font-semibold ${sameDay(d, now) ? 'text-purple-700' : ''}`}>{d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}{sameDay(d, now) && ' (today)'}</h3>
                {!its.length ? <p className="mt-1 text-sm text-ink/60">Nothing scheduled.</p> : (
                  <ul className="mt-2 grid gap-2">
                    {its.map((i) => (
                      <li key={i.id} className={`rounded-control p-3 text-sm ${KIND_STYLE[i.kind]}`}>
                        <p className={`font-semibold ${i.cancelled ? 'line-through' : ''}`}>{i.title}{i.cancelled && ' (cancelled)'}</p>
                        <p>{KIND_LABEL[i.kind]}{!i.allDay && ` · ${time(i.start)}${i.end ? ` to ${time(i.end)}` : ''}`}{i.detail ? ` · ${i.detail}` : ''}</p>
                        <div className="mt-1 flex gap-3">
                          {canJoin(i, now) && <a href={i.url!} target="_blank" rel="noopener noreferrer" className="font-semibold underline">Join online session</a>}
                          {i.kind === 'session' && canOpenSession && <Link to={`/sessions/${i.id}`} className="underline">Session details</Link>}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
