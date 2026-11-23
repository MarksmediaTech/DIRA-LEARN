import { attentionItems, attentionSources } from './attention';

describe('dashboard "Needs your attention" (Phase 9)', () => {
  it('asks each role only for the figures it may see', () => {
    expect(attentionSources('trainer', false)).toEqual(['gradingWaiting', 'learnersNeedingSupport']);
    expect(attentionSources('programme_coordinator', false)).toEqual(['learnersNeedingSupport', 'reportsOpen', 'filesWaitingScan']);
    expect(attentionSources('founder', false)).toEqual(['learnersNeedingSupport', 'reportsOpen', 'filesWaitingScan', 'concernsWithoutOfficer']);
    expect(attentionSources('programme_director', true)).toEqual(['learnersNeedingSupport', 'reportsOpen', 'filesWaitingScan', 'safeguardingOpen', 'safeguardingOverdue']);
    for (const r of ['participant', 'mentor', 'me_officer', 'applicant', null]) expect(attentionSources(r, false)).toEqual([]);
  });
  it('shows nothing when nothing is waiting', () => {
    expect(attentionItems({})).toEqual([]);
    expect(attentionItems({ gradingWaiting: 0, reportsOpen: 0 })).toEqual([]);
  });
  it('puts safeguarding first, marks it urgent, and words counts correctly', () => {
    const items = attentionItems({ gradingWaiting: 1, learnersNeedingSupport: 3, safeguardingOverdue: 2, concernsWithoutOfficer: 1 });
    expect(items.map((i) => i.key)).toEqual(['no-officer', 'sg-overdue', 'grading', 'support']);
    expect(items.filter((i) => i.urgent).map((i) => i.key)).toEqual(['no-officer', 'sg-overdue']);
    expect(items[0]?.text).toBe('1 safeguarding concern is waiting and no Safeguarding Lead or Deputy is appointed');
    expect(items[2]?.text).toBe('1 piece of work is waiting for your grade');
    expect(items[3]?.text).toBe('3 learners may need support');
  });
  it('never puts safeguarding details in the text, only counts', () => {
    for (const i of attentionItems({ safeguardingOpen: 4, safeguardingOverdue: 1 })) expect(i.text).toMatch(/^\d+ safeguarding concerns? /);
  });
});
