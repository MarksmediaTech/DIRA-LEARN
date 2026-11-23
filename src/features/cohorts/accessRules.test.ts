import { cohortSchema } from './schema';
import { ACCESS_LABEL, ACCESS_MANAGER_ROLES, canManageAccess, describeAccess, headlineAccess, isoToLocalInput, optionalLocalToIso, validateAccessWindow } from './accessRules';

describe('learning access helpers', () => {
  it('has a label for each of the five statuses', () => {
    expect(Object.keys(ACCESS_LABEL).sort()).toEqual(['active', 'expired', 'pending', 'scheduled', 'suspended']);
  });
  it('treats empty input as not set', () => {
    expect(optionalLocalToIso('')).toBeNull();
    expect(optionalLocalToIso('   ')).toBeNull();
    expect(optionalLocalToIso(undefined)).toBeNull();
    expect(optionalLocalToIso('not a date')).toBeNull();
    expect(isoToLocalInput(null)).toBe('');
    expect(isoToLocalInput('garbage')).toBe('');
  });
  it('round-trips a timestamp through the datetime-local format', () => {
    const iso = '2027-01-05T08:30:00.000Z';
    expect(optionalLocalToIso(isoToLocalInput(iso))).toBe(iso);
  });
  it('rejects access that closes before or when it opens, and allows open ends', () => {
    expect(validateAccessWindow('2027-01-05T08:00', '2027-01-05T08:00')).toMatch(/after it opens/);
    expect(validateAccessWindow('2027-01-05T08:00', '2027-01-04T08:00')).toMatch(/after it opens/);
    expect(validateAccessWindow('2027-01-05T08:00', '2027-02-05T08:00')).toBeNull();
    expect(validateAccessWindow('', '2027-02-05T08:00')).toBeNull();
    expect(validateAccessWindow('2027-01-05T08:00', '')).toBeNull();
    expect(validateAccessWindow('', '')).toBeNull();
  });
  it('explains each status to the learner without exposing anything else', () => {
    expect(describeAccess('scheduled', '2027-01-05T08:00:00.000Z', null)).toMatch(/opens on/);
    expect(describeAccess('expired', null, null)).toMatch(/has ended/);
    expect(describeAccess('expired', null, null)).toMatch(/view your results/);
    expect(describeAccess('suspended', null, null)).toMatch(/paused/);
    expect(describeAccess('pending', null, null)).toMatch(/not been scheduled/);
    expect(describeAccess('active', null, null)).toMatch(/open/);
  });
  it('picks the most useful status to show a learner', () => {
    expect(headlineAccess([{ status: 'expired' }, { status: 'active' }])?.status).toBe('active');
    expect(headlineAccess([{ status: 'pending' }, { status: 'scheduled' }])?.status).toBe('scheduled');
    expect(headlineAccess([])).toBeNull();
  });
});

describe('cohort form with intake and access fields', () => {
  const base = { name: 'November 2026', startDate: '2026-11-02', endDate: '2026-11-27', capacity: 30 };
  it('still accepts a cohort with none of the new fields', () => { expect(cohortSchema.safeParse(base).success).toBe(true); });
  it('accepts a November registration with January access', () => {
    expect(cohortSchema.safeParse({ ...base, intakeLabel: 'November 2026 recruitment', recruitmentOpensOn: '2026-11-01', recruitmentClosesOn: '2026-11-30', accessOpensAt: '2027-01-11T08:00', accessClosesAt: '2027-02-12T18:00' }).success).toBe(true);
  });
  it('rejects recruitment that closes before it opens', () => {
    expect(cohortSchema.safeParse({ ...base, recruitmentOpensOn: '2026-11-30', recruitmentClosesOn: '2026-11-01' }).success).toBe(false);
  });
  it('rejects portal access that closes before it opens', () => {
    expect(cohortSchema.safeParse({ ...base, accessOpensAt: '2027-02-12T18:00', accessClosesAt: '2027-01-11T08:00' }).success).toBe(false);
  });
});

describe('programme time zone in the access helpers', () => {
  it('reads typed times in the programme zone, not the browser zone', () => {
    expect(optionalLocalToIso('2027-01-11T08:00', 'Africa/Nairobi')).toBe('2027-01-11T05:00:00.000Z');
    expect(isoToLocalInput('2027-01-11T05:00:00.000Z', 'Africa/Nairobi')).toBe('2027-01-11T08:00');
  });
  it('shows the learner their dates in the programme zone', () => {
    expect(describeAccess('scheduled', '2027-01-11T05:00:00.000Z', null, 'Africa/Nairobi')).toMatch(/opens on/);
  });
});

describe('who may change access', () => {
  it('allows only super admin, Founder, Co-Founder and programme director', () => {
    expect([...ACCESS_MANAGER_ROLES]).toEqual(['super_admin', 'founder', 'co_founder', 'programme_director']);
    for (const r of ['super_admin', 'founder', 'co_founder', 'programme_director']) expect(canManageAccess(r)).toBe(true);
    for (const r of ['programme_coordinator', 'trainer', 'me_officer', 'mentor', 'participant', 'applicant', '', null, undefined]) expect(canManageAccess(r)).toBe(false);
  });
});
