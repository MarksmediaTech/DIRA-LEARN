import {
  GENERIC_SENT, PROBLEM_MESSAGES, RECOVERY_FLAG, classifyAuthError, cleanCode, clearRecoveryPending, cooldownLeft, isCodeShaped, isRecoveryPending,
  markRecoveryPending, normaliseEmail, validateNewPassword, validateRecoveryEmail,
} from './recoveryRules';

const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); }, m }; };

describe('password recovery rules', () => {
  it('normalises the email and checks its shape', () => {
    expect(normaliseEmail('  Amina@Example.ORG ')).toBe('amina@example.org');
    expect(validateRecoveryEmail('amina@example.org')).toBeNull();
    expect(validateRecoveryEmail('amina')).toMatch(/email address/);
  });
  it('accepts 6 to 10 digit codes, ignoring spaces and dashes', () => {
    expect(isCodeShaped('123456')).toBe(true);
    expect(isCodeShaped(' 123 456 ')).toBe(true);
    expect(isCodeShaped('123-456')).toBe(true);
    expect(cleanCode('12 34-56')).toBe('123456');
    expect(isCodeShaped('12345')).toBe(false);
    expect(isCodeShaped('12345a')).toBe(false);
    expect(isCodeShaped('12345678901')).toBe(false);
  });
  it('uses the existing DIRA LEARN password rules and requires a matching confirmation', () => {
    expect(validateNewPassword('learn-2026-ok', 'learn-2026-ok', 'amina@example.org')).toBeNull();
    expect(validateNewPassword('short1', 'short1', '')).toMatch(/at least 10/);
    expect(validateNewPassword('onlyletterspassword', 'onlyletterspassword', '')).toMatch(/letters and numbers/);
    expect(validateNewPassword('learn-2026-ok', 'learn-2026-no', '')).toMatch(/do not match/);
    expect(validateNewPassword('amina2026@example.org', 'amina2026@example.org', 'amina2026@example.org')).toMatch(/email/);
  });
  it('counts down the resend cooldown', () => {
    expect(cooldownLeft(null, 1000)).toBe(0);
    expect(cooldownLeft(0, 1000)).toBe(59);
    expect(cooldownLeft(0, 59_001)).toBe(1);
    expect(cooldownLeft(0, 60_000)).toBe(0);
    expect(cooldownLeft(0, 120_000)).toBe(0);
  });
  it('maps Supabase Auth errors to clear messages', () => {
    expect(classifyAuthError({ status: 403, code: 'otp_expired', message: 'Token has expired or is invalid' })).toBe('invalid_code');
    expect(classifyAuthError({ status: 429, code: 'over_request_rate_limit' })).toBe('rate_limited');
    expect(classifyAuthError({ status: 429, code: 'over_email_send_rate_limit' })).toBe('rate_limited');
    expect(classifyAuthError({ status: 422, code: 'weak_password' })).toBe('weak_password');
    expect(classifyAuthError({ status: 422, code: 'same_password' })).toBe('same_password');
    expect(classifyAuthError({ name: 'AuthSessionMissingError', status: 400 })).toBe('session_missing');
    expect(classifyAuthError({ name: 'AuthRetryableFetchError', status: 0 })).toBe('network');
    expect(classifyAuthError(null)).toBe('unknown');
    expect(PROBLEM_MESSAGES.invalid_code).toMatch(/not correct or has expired/);
  });
  it('never reveals whether an account exists', () => {
    expect(GENERIC_SENT).toMatch(/^If an account exists/);
    for (const m of Object.values(PROBLEM_MESSAGES)) expect(/not registered|no account|does not exist|unknown email/i.test(m)).toBe(false);
  });
  it('keeps a verified recovery on the new-password step until the password is saved', () => {
    const s = memory();
    expect(isRecoveryPending(s)).toBe(false);
    markRecoveryPending(s);
    expect(isRecoveryPending(s)).toBe(true);
    expect(/\d/.test(s.m.get(RECOVERY_FLAG) ?? '')).toBe(true);       // a timestamp only, never a code or token
    clearRecoveryPending(s);
    expect(isRecoveryPending(s)).toBe(false);
    expect(isRecoveryPending(null)).toBe(false);
  });
});
