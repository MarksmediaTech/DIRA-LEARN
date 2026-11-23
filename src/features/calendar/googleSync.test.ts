import { canSeeGoogleSync, summarise } from './googleSync';

describe('Google Calendar sync panel', () => {
  it('is shown to programme staff and trainers only', () => {
    expect(canSeeGoogleSync('programme_director')).toBe(true); expect(canSeeGoogleSync('trainer')).toBe(true);
    for (const r of ['participant', 'mentor', 'me_officer', 'applicant', null]) expect(canSeeGoogleSync(r)).toBe(false);
  });
  it('counts waiting, synced (incl. removed cancellations) and failed changes and keeps distinct errors', () => {
    const s = summarise([
      { state: 'pending', last_error: null, synced_at: null, attempts: 0 }, { state: 'syncing', last_error: null, synced_at: null, attempts: 1 },
      { state: 'synced', last_error: null, synced_at: '2026-11-22T10:00:00Z', attempts: 1 }, { state: 'deleted', last_error: null, synced_at: '2026-11-22T11:00:00Z', attempts: 1 },
      { state: 'failed', last_error: 'HTTP 403', synced_at: null, attempts: 8 }, { state: 'failed', last_error: 'HTTP 403', synced_at: null, attempts: 8 },
    ]);
    expect(s).toEqual({ waiting: 2, synced: 2, failed: 2, lastSynced: '2026-11-22T11:00:00Z', errors: ['HTTP 403'] });
  });
  it('an empty queue is up to date', () => { expect(summarise([])).toEqual({ waiting: 0, synced: 0, failed: 0, lastSynced: null, errors: [] }); });
});
