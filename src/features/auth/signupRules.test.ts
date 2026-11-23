import { isEmail, validatePassword, validateSignUp } from './signupRules';

describe('validatePassword', () => {
  it('accepts a long password with letters and numbers', () => expect(validatePassword('learn-2026-ok')).toBeNull());
  it('rejects short, letters-only, digits-only and email-as-password', () => {
    expect(validatePassword('abc123')).toMatch(/at least 10/);
    expect(validatePassword('onlyletterspassword')).toMatch(/letters and numbers/);
    expect(validatePassword('1234567890123')).toMatch(/letters and numbers/);
    expect(validatePassword('Amina2026ab', 'amina2026ab')).toMatch(/same as your email/);
  });
});

describe('validateSignUp', () => {
  const ok = { email: 'amina@example.org', password: 'learn-2026-ok', confirm: 'learn-2026-ok', consent: true };
  it('accepts valid input', () => expect(validateSignUp(ok)).toBeNull());
  it('checks each field in turn', () => {
    expect(validateSignUp({ ...ok, email: 'nope' })).toMatch(/email/);
    expect(validateSignUp({ ...ok, password: 'short1', confirm: 'short1' })).toMatch(/at least/);
    expect(validateSignUp({ ...ok, confirm: 'different-2026' })).toMatch(/do not match/);
    expect(validateSignUp({ ...ok, consent: false })).toMatch(/tick the box/);
  });
});

describe('isEmail', () => {
  it('accepts normal addresses and rejects malformed or overlong ones', () => {
    expect(isEmail(' a@b.org ')).toBe(true);
    expect(isEmail('a@b')).toBe(false);
    expect(isEmail('a b@c.org')).toBe(false);
    expect(isEmail('a'.repeat(250) + '@b.org')).toBe(false);
  });
});
