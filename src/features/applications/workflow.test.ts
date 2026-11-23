import { ageFromDob, canConvert, canDecide, canTransition, decisionGroup, matchesSearch, nextStatuses, noteRequired, PENDING_STATUSES, reviewMoves, REVIEW_STATUSES } from './workflow';

describe('application workflow', () => {
  it('starts review from submitted only', () => {
    expect(nextStatuses('submitted')).toEqual(['under_review', 'rejected']);
    expect(canTransition('submitted', 'accepted')).toBe(false);
  });
  it('never lets applicants drafts or accepted applications move', () => {
    expect(nextStatuses('draft')).toEqual([]);
    expect(nextStatuses('accepted')).toEqual([]);
  });
  it('allows a waitlisted applicant to be accepted', () => {
    expect(canTransition('waitlisted', 'accepted')).toBe(true);
  });
  it('requires a note to reject or reconsider', () => {
    expect(noteRequired('under_review', 'rejected')).toBe(true);
    expect(noteRequired('rejected', 'under_review')).toBe(true);
    expect(noteRequired('under_review', 'shortlisted')).toBe(false);
  });
  it('every reviewable status except accepted has a way forward', () => {
    for (const s of REVIEW_STATUSES.filter((x) => x !== 'accepted')) expect(nextStatuses(s).length).toBeGreaterThan(0);
  });
  it('limits conversion to accepted, unconverted applications and the roles the Edge Function allows', () => {
    expect(canConvert('programme_coordinator', 'accepted', false)).toBe(true);
    expect(canConvert('programme_coordinator', 'accepted', true)).toBe(false);
    expect(canConvert('programme_coordinator', 'shortlisted', false)).toBe(false);
    expect(canConvert('trainer', 'accepted', false)).toBe(false);
  });
  it('computes age and tolerates bad dates', () => {
    expect(ageFromDob('2000-06-15', new Date('2026-06-14'))).toBe(25);
    expect(ageFromDob('2000-06-15', new Date('2026-06-15'))).toBe(26);
    expect(ageFromDob('not a date')).toBeNull();
    expect(ageFromDob(undefined)).toBeNull();
  });
  it('searches case-insensitively and treats empty as match-all', () => {
    expect(matchesSearch('Amina Wanjiru', 'wanj')).toBe(true);
    expect(matchesSearch('Amina Wanjiru', '  ')).toBe(true);
    expect(matchesSearch('Amina Wanjiru', 'otieno')).toBe(false);
  });
});

describe('approval management', () => {
  it('groups every status as pending, approved or rejected (drafts belong to nobody)', () => {
    for (const s of PENDING_STATUSES) expect(decisionGroup(s)).toBe('pending');
    expect(decisionGroup('accepted')).toBe('approved');
    expect(decisionGroup('rejected')).toBe('rejected');
    expect(decisionGroup('draft')).toBeNull();
  });
  it('lets only a super administrator or programme director decide a pending application', () => {
    expect(canDecide('super_admin', 'submitted', 'a', 'me')).toBe(true);
    expect(canDecide('programme_director', 'under_review', 'a', 'me')).toBe(true);
    expect(canDecide('programme_coordinator', 'submitted', 'a', 'me')).toBe(false);
    for (const r of ['trainer', 'participant', 'applicant', 'mentor', 'me_officer'] as const) expect(canDecide(r, 'submitted', 'a', 'me')).toBe(false);
  });
  it('does not offer a decision on finished applications or on your own application', () => {
    expect(canDecide('super_admin', 'accepted', 'a', 'me')).toBe(false);
    expect(canDecide('super_admin', 'rejected', 'a', 'me')).toBe(false);
    expect(canDecide('super_admin', 'draft', 'a', 'me')).toBe(false);
    expect(canDecide('super_admin', 'submitted', 'me', 'me')).toBe(false);
  });
  it('keeps review steps but takes Accept and Reject out of the status buttons', () => {
    expect(reviewMoves('submitted')).toEqual(['under_review']);
    expect(reviewMoves('under_review')).toEqual(['shortlisted', 'waitlisted']);
    expect(reviewMoves('rejected')).toEqual(['under_review']);
    for (const s of REVIEW_STATUSES) expect(reviewMoves(s)).not.toContain('accepted');
  });
});
