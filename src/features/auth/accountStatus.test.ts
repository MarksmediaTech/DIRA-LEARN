import { INACTIVE_MESSAGE, inactiveProfile, isInactiveAccountError, signInErrorMessage } from './accountStatus';

describe('deactivated accounts (migration 34)', () => {
  it('recognises the database refusal of an inactive account', () => {
    expect(isInactiveAccountError({ code: '42501', message: 'DIRA_ACCOUNT_INACTIVE' })).toBe(true);
    expect(isInactiveAccountError({ code: '42501', message: 'permission denied for table x' })).toBe(false);
    expect(isInactiveAccountError(null)).toBe(false);
  });
  it('gives a placeholder profile that is never active and never privileged', () => {
    const p = inactiveProfile('abc');
    expect(p.status).toBe('deactivated'); expect(p.role).toBe('applicant'); expect(p.id).toBe('abc');
  });
  it('turns the Supabase "banned" sign-in error into a plain message', () => {
    expect(signInErrorMessage('User is banned')).toBe(INACTIVE_MESSAGE);
    expect(signInErrorMessage('Invalid login credentials')).toBe('Invalid login credentials');
  });
});
