import { filterResources, groupResources, safeExternalUrl, type ResourceRow } from './rules';

const row = (id: string, title: string, kind: ResourceRow['kind'], s: ResourceRow['curriculum_sessions']): ResourceRow =>
  ({ id, title, kind, storage_path: null, external_url: 'https://example.org', created_at: '2026-11-01', curriculum_sessions: s });
const wk1s2 = { week_no: 1, session_no: 2, title: 'CV writing', track_id: null };
const wk1s1 = { week_no: 1, session_no: 1, title: 'Digital basics', track_id: null };
const wk2s1 = { week_no: 2, session_no: 1, title: 'Spreadsheets', track_id: 't1' };
const rows = [row('a', 'CV template', 'document', wk1s2), row('b', 'Intro video', 'video', wk1s1), row('c', 'Cheat sheet', 'document', wk2s1), row('d', 'Reading list', 'link', null), row('e', 'CV examples', 'link', wk1s2)];

describe('safe links', () => {
  it('allows http and https only', () => {
    expect(safeExternalUrl('https://example.org/a?b=1')).toBe('https://example.org/a?b=1');
    expect(safeExternalUrl('http://example.org/')).toBe('http://example.org/');
  });
  it('rejects script, data, file and malformed links', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'example.org', '', null]) expect(safeExternalUrl(bad)).toBeNull();
  });
});

describe('grouping', () => {
  it('orders by week then session, keeps a session together and puts General last', () => {
    const g = groupResources(rows);
    expect(g.map((x) => x.heading)).toEqual(['Week 1 · Session 1: Digital basics', 'Week 1 · Session 2: CV writing', 'Week 2 · Session 1: Spreadsheets', 'General']);
    expect(g[1]?.items.map((r) => r.title)).toEqual(['CV examples', 'CV template']);
  });
  it('returns nothing for nothing', () => expect(groupResources([])).toEqual([]));
});

describe('filtering', () => {
  it('matches title or session title, case-insensitively', () => {
    expect(filterResources(rows, { query: 'cv', kind: '' }).map((r) => r.id)).toEqual(['a', 'e']);
    expect(filterResources(rows, { query: 'SPREAD', kind: '' }).map((r) => r.id)).toEqual(['c']);
  });
  it('filters by kind and combines with the search', () => {
    expect(filterResources(rows, { query: '', kind: 'link' }).map((r) => r.id)).toEqual(['d', 'e']);
    expect(filterResources(rows, { query: 'cv', kind: 'link' }).map((r) => r.id)).toEqual(['e']);
  });
});
