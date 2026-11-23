import { addDays, canJoin, foldLine, icsEscape, itemsOn, monthGrid, shift, startOfWeek, toIcs, visibleRange, type CalendarItem } from './rules';

const item = (over: Partial<CalendarItem> = {}): CalendarItem => ({ id: 'a', kind: 'session', title: 'T', start: new Date(2026, 10, 4, 9), end: new Date(2026, 10, 4, 10), allDay: false, ...over });

describe('weeks and months', () => {
  it('starts weeks on Monday', () => {
    expect(startOfWeek(new Date(2026, 10, 4)).getDate()).toBe(2); // Wed 4 Nov 2026 -> Mon 2 Nov
    expect(startOfWeek(new Date(2026, 10, 8)).getDate()).toBe(2); // Sunday belongs to the week before
  });
  it('builds a month grid of full Monday-first weeks covering the month', () => {
    const g = monthGrid(new Date(2026, 10, 15));
    expect(g.every((w) => w.length === 7)).toBe(true);
    expect(g[0]![0]!.getDay()).toBe(1);
    expect(g.flat().some((d) => d.getMonth() === 10 && d.getDate() === 1)).toBe(true);
    expect(g.flat().some((d) => d.getMonth() === 10 && d.getDate() === 30)).toBe(true);
  });
  it('gives the visible range for each view', () => {
    const a = new Date(2026, 10, 4);
    expect(visibleRange('day', a).to.getDate()).toBe(5);
    expect(visibleRange('week', a).from.getDate()).toBe(2);
    expect(visibleRange('week', a).to.getDate()).toBe(9);
    expect(visibleRange('month', a).from <= new Date(2026, 10, 1)).toBe(true);
  });
  it('moves by a day, a week or a month', () => {
    const a = new Date(2026, 10, 4);
    expect(shift('day', a, 1).getDate()).toBe(5);
    expect(shift('week', a, -1).getDate()).toBe(28);
    expect(shift('month', a, 1).getMonth()).toBe(11);
  });
});

describe('itemsOn', () => {
  it('returns the day\'s items in time order', () => {
    const late = item({ id: 'l', start: new Date(2026, 10, 4, 15) });
    const early = item({ id: 'e', start: new Date(2026, 10, 4, 8) });
    const other = item({ id: 'o', start: addDays(new Date(2026, 10, 4), 1) });
    expect(itemsOn([late, other, early], new Date(2026, 10, 4)).map((i) => i.id)).toEqual(['e', 'l']);
  });
});

describe('canJoin', () => {
  const now = new Date(2026, 10, 4, 9, 30);
  it('offers a link for a live or upcoming online session with a link', () => expect(canJoin(item({ mode: 'online', url: 'https://x.org' }), now)).toBe(true));
  it('does not for physical, missing link, cancelled, finished or non-session items', () => {
    expect(canJoin(item({ mode: 'physical', url: 'https://x.org' }), now)).toBe(false);
    expect(canJoin(item({ mode: 'online', url: null }), now)).toBe(false);
    expect(canJoin(item({ mode: 'online', url: 'https://x.org', cancelled: true }), now)).toBe(false);
    expect(canJoin(item({ mode: 'online', url: 'https://x.org' }), new Date(2026, 10, 4, 11)) ).toBe(false);
    expect(canJoin(item({ kind: 'assignment', mode: 'online', url: 'https://x.org' }), now)).toBe(false);
  });
});

describe('ics', () => {
  it('escapes special characters', () => expect(icsEscape('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne'));
  it('folds long lines at 75 octets with a leading space on continuations', () => {
    const folded = foldLine('X'.repeat(200)).split('\r\n');
    expect(folded[0]!.length).toBe(75);
    expect(folded.slice(1).every((l) => l.startsWith(' ') && l.length <= 75)).toBe(true);
    expect(folded.join('').replace(/ /g, '')).toBe('X'.repeat(200));
  });
  it('writes a valid calendar, skipping cancelled items and using date-only for all-day items', () => {
    const ics = toIcs([item({ id: 's1', title: 'Session, one' }), item({ id: 'c', cancelled: true }), item({ id: 'd', kind: 'assignment', allDay: true, end: null, start: new Date(2026, 10, 9) })], new Date(Date.UTC(2026, 10, 4)));
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('SUMMARY:Session\\, one');
    expect(ics).toContain('DTSTART;VALUE=DATE:20261109');
    expect(ics.includes('UID:c@dira-learn')).toBe(false);
    expect(ics.match(/BEGIN:VEVENT/g)?.length).toBe(2);
  });
});
