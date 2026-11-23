import { FILE_ACCEPT, FILE_RULES, REACTIONS, announcementProblem, avatarColour, baseMime, categoryOf, deliveryState, fileProblem, formatBytes, initials,
  isReaction, isSection, matchesQuery, nextToasts, relativeTime, safeInternalLink, sectionOfKind, shortTime } from './rules';

const MB = 1024 * 1024;
describe('reactions', () => {
  it('offers exactly the 16 emoji the database accepts', () => {
    expect(REACTIONS.map((r) => r.emoji)).toEqual(['👍', '❤️', '😂', '😮', '😢', '🙏', '👏', '🎉', '🔥', '💯', '✅', '👀', '🤔', '💡', '📌', '🙌']);
    expect(isReaction('👍')).toBe(true); expect(isReaction('🍕')).toBe(false);
  });
});

describe('files', () => {
  it('lists 24 supported types in 4 categories, matching chat_file_rules', () => {
    expect(Object.keys(FILE_RULES)).toHaveLength(24);
    expect(categoryOf('video/mp4')).toBe('video'); expect(categoryOf('audio/webm;codecs=opus')).toBe('audio'); expect(categoryOf('image/svg+xml')).toBeNull();
    expect(baseMime('Audio/WebM; codecs=opus')).toBe('audio/webm');
    expect(FILE_ACCEPT).toContain('.pptx'); expect(FILE_ACCEPT).toContain('.mp4'); expect(FILE_ACCEPT).not.toContain('.svg');
  });
  it('refuses unsupported, empty, too large and too many files with clear messages', () => {
    expect(fileProblem([{ name: 'a.svg', size: 10, type: 'image/svg+xml' }])).toMatch(/not supported/);
    expect(fileProblem([{ name: 'a.pdf', size: 0, type: 'application/pdf' }])).toMatch(/empty/);
    expect(fileProblem([{ name: 'big.webm', size: 21 * MB, type: 'audio/webm' }])).toMatch(/larger than 20.0 MB/);
    expect(fileProblem([{ name: 'v.mp4', size: 49 * MB, type: 'video/mp4' }])).toBeNull();
    expect(fileProblem(Array.from({ length: 4 }, (_, i) => ({ name: `f${i}.pdf`, size: 1, type: 'application/pdf' })))).toMatch(/at most 3/);
    expect(fileProblem(Array.from({ length: 4 }, (_, i) => ({ name: `f${i}.pdf`, size: 1, type: 'application/pdf' })), 10)).toBeNull();
  });
  it('formats sizes', () => { expect(formatBytes(900)).toBe('900 B'); expect(formatBytes(2048)).toBe('2 KB'); expect(formatBytes(5.5 * MB)).toBe('5.5 MB'); });
});

describe('people and time', () => {
  it('initials and a stable colour', () => {
    expect(initials('Mary Wanjiku')).toBe('MW'); expect(initials('Brian Njima Otieno')).toBe('BO'); expect(initials('')).toBe('?');
    expect(avatarColour('abc')).toBe(avatarColour('abc'));
  });
  it('short times for lists', () => {
    const now = new Date('2026-11-22T12:00:00Z');
    expect(shortTime('2026-11-22T09:05:00Z', now, 'UTC')).toBe('09:05');
    expect(shortTime('2026-11-21T09:05:00Z', now, 'UTC')).toBe('Yesterday');
    expect(shortTime('2026-11-01T09:05:00Z', now, 'UTC')).toBe('1 Nov');
    expect(shortTime(null, now)).toBe('');
  });
  it('relative times for notifications', () => {
    const now = new Date('2026-11-22T12:00:00Z');
    expect(relativeTime('2026-11-22T11:59:30Z', now)).toBe('just now');
    expect(relativeTime('2026-11-22T11:50:00Z', now)).toBe('10 min ago');
    expect(relativeTime('2026-11-22T09:00:00Z', now)).toBe('3 h ago');
    expect(relativeTime('2026-11-20T12:00:00Z', now)).toBe('2 d ago');
  });
});

describe('navigation', () => {
  it('sections and where conversations belong', () => {
    expect(isSection('groups')).toBe(true); expect(isSection('notifications')).toBe(false); expect(isSection(null)).toBe(false);
    expect(sectionOfKind('dm')).toBe('direct'); expect(sectionOfKind('direct')).toBe('direct'); expect(sectionOfKind('safeguarding')).toBe('direct');
    expect(sectionOfKind('group')).toBe('groups'); expect(sectionOfKind('cohort')).toBe('groups');
  });
  it('follows only internal notification links', () => {
    expect(safeInternalLink('/chat?c=1234&m=5')).toBe('/chat?c=1234&m=5');
    expect(safeInternalLink('//evil.example/x')).toBeNull();
    expect(safeInternalLink('https://evil.example')).toBeNull();
    expect(safeInternalLink('javascript:alert(1)')).toBeNull();
    expect(safeInternalLink(null)).toBeNull();
  });
});

describe('messages', () => {
  it('search inside a conversation', () => { expect(matchesQuery('Hello Brief', 'brief')).toBe(true); expect(matchesQuery('Hello', 'x')).toBe(false); expect(matchesQuery(null, '')).toBe(true); });
  it('Seen only when every other member has read past the message', () => {
    expect(deliveryState('2026-11-22T10:00:00Z', [{ last_read_at: '2026-11-22T10:01:00Z' }], 1)).toBe('seen');
    expect(deliveryState('2026-11-22T10:00:00Z', [{ last_read_at: '2026-11-22T09:59:00Z' }], 1)).toBe('sent');
    expect(deliveryState('2026-11-22T10:00:00Z', [{ last_read_at: '2026-11-22T10:01:00Z' }], 2)).toBe('sent');
    expect(deliveryState('2026-11-22T10:00:00Z', [], 0)).toBe('sent');
  });
  it('a notification pops up once, at most 3 at a time', () => {
    const shown = new Set<string>(); let v: { id: string }[] = [];
    v = nextToasts(v, { id: 'a' }, shown); v = nextToasts(v, { id: 'a' }, shown);
    expect(v.map((x) => x.id)).toEqual(['a']);
    for (const id of ['b', 'c', 'd']) v = nextToasts(v, { id }, shown);
    expect(v.map((x) => x.id)).toEqual(['b', 'c', 'd']);
  });
});

describe('announcements', () => {
  const base = { title: 'Week 1', body: 'Notes', audience: 'everyone' as const, cohortId: '', trackId: '' };
  it('checks title, length and audience', () => {
    expect(announcementProblem(base)).toBeNull();
    expect(announcementProblem({ ...base, title: 'Hi' })).toMatch(/title/);
    expect(announcementProblem({ ...base, audience: 'cohort' })).toMatch(/cohort/);
    expect(announcementProblem({ ...base, audience: 'track' })).toMatch(/track/);
    expect(announcementProblem({ ...base, body: 'x'.repeat(5001) })).toMatch(/5000/);
  });
});
