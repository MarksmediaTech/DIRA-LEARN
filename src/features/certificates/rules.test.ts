import { evaluateEligibility, isCertificateNo, publicVerifyUrl, type CompletionFigures } from './rules';

const rule = { min_sessions_attended: 6, require_core_sessions: true, require_final_project: true, require_reflection: true, is_approved: true };
const full: CompletionFigures = { sessionsAttended: 7, coreAttended: 2, coreTotal: 2, finalSubmitted: true, reflectionSubmitted: true };

describe('evaluateEligibility', () => {
  it('is never eligible without approved rules', () => {
    expect(evaluateEligibility(null, full)).toEqual({ checks: [], eligible: false, blockedBy: 'no_approved_rules' });
    expect(evaluateEligibility({ ...rule, is_approved: false }, full).eligible).toBe(false);
  });
  it('is eligible when every approved requirement is met', () => expect(evaluateEligibility(rule, full).eligible).toBe(true));
  it('fails on attendance, core, final project and reflection individually', () => {
    expect(evaluateEligibility(rule, { ...full, sessionsAttended: 5 }).checks.find((c) => c.key === 'sessions')?.ok).toBe(false);
    expect(evaluateEligibility(rule, { ...full, coreAttended: 1 }).eligible).toBe(false);
    expect(evaluateEligibility(rule, { ...full, finalSubmitted: false }).eligible).toBe(false);
    expect(evaluateEligibility(rule, { ...full, reflectionSubmitted: false }).eligible).toBe(false);
  });
  it('skips requirements the rule does not set', () => {
    const e = evaluateEligibility({ ...rule, min_sessions_attended: null, require_core_sessions: false, require_final_project: false, require_reflection: false }, { sessionsAttended: 0, coreAttended: 0, coreTotal: 0, finalSubmitted: false, reflectionSubmitted: false });
    expect(e.checks).toEqual([]);
    expect(e.eligible).toBe(true);
  });
  it('does not treat "no core sessions scheduled" as meeting the core requirement', () => {
    expect(evaluateEligibility(rule, { ...full, coreAttended: 0, coreTotal: 0 }).eligible).toBe(false);
  });
});

describe('certificate numbers', () => {
  it('accepts the DL-YYYY-NNNNNN format only', () => {
    expect(isCertificateNo('DL-2026-000123')).toBe(true);
    expect(isCertificateNo(' DL-2026-000123 ')).toBe(true);
    expect(isCertificateNo('DL-2026-123')).toBe(false);
    expect(isCertificateNo("DL-2026-000123'; drop")).toBe(false);
  });
  it('builds an encoded verification link', () => expect(publicVerifyUrl('https://x.org', 'DL-2026-000123')).toBe('https://x.org/verify?no=DL-2026-000123'));
});
