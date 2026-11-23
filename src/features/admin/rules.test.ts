import { ASSIGNABLE_ROLES, STATUS_LABEL, changedFields, formatSettingValue, isEmail, parseSettingValue, statusReasonProblem } from './rules';

describe('parseSettingValue', () => {
  it('parses JSON values', () => {
    expect(parseSettingValue('true')).toEqual({ value: true, error: null });
    expect(parseSettingValue('{"min_sessions":6}').value).toEqual({ min_sessions: 6 });
    expect(parseSettingValue('"Africa/Nairobi"').value).toBe('Africa/Nairobi');
  });
  it('rejects empty and invalid input', () => {
    expect(parseSettingValue('  ').error).toMatch(/Enter a value/);
    expect(parseSettingValue('Africa/Nairobi').error).toMatch(/valid JSON/);
  });
  it('formats values for editing', () => expect(parseSettingValue(formatSettingValue({ a: [1, 2] })).value).toEqual({ a: [1, 2] }));
});

describe('changedFields', () => {
  it('lists differing fields only', () => {
    expect(changedFields({ a: 1, b: 2, c: { x: 1 } }, { a: 1, b: 3, c: { x: 1 }, d: 4 })).toEqual(['b', 'd']);
  });
  it('is empty for inserts and deletes', () => {
    expect(changedFields(null, { a: 1 })).toEqual([]);
    expect(changedFields({ a: 1 }, null)).toEqual([]);
  });
});

describe('roles and email', () => {
  it('never offers participant for manual assignment', () => expect(ASSIGNABLE_ROLES).not.toContain('participant'));
  it('lets a super administrator assign the Founder and Co-Founder roles', () => { expect(ASSIGNABLE_ROLES).toContain('founder'); expect(ASSIGNABLE_ROLES).toContain('co_founder'); });
  it('checks email shape', () => {
    expect(isEmail('a@b.org')).toBe(true);
    expect(isEmail('a@b')).toBe(false);
    expect(isEmail('a b@c.org')).toBe(false);
  });
});

describe('account status (migration 34)', () => {
  it('requires a reason of 10 to 500 characters, like admin_set_account_status()', () => {
    expect(statusReasonProblem('short')).not.toBeNull();
    expect(statusReasonProblem('          ')).not.toBeNull();
    expect(statusReasonProblem('Contract ended')).toBeNull();
    expect(statusReasonProblem('x'.repeat(501))).not.toBeNull();
  });
  it('labels every status', () => { expect(STATUS_LABEL.deactivated).toBe('Deactivated'); expect(STATUS_LABEL.active).toBe('Active'); });
});
