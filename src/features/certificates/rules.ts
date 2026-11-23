import type { GraduationRule } from '@/types/database';

export interface CompletionFigures { sessionsAttended: number; coreAttended: number; coreTotal: number; finalSubmitted: boolean; reflectionSubmitted: boolean }
export interface RuleCheck { key: string; label: string; ok: boolean }
export interface Eligibility { checks: RuleCheck[]; eligible: boolean; blockedBy: 'no_approved_rules' | null }
type RuleFields = Pick<GraduationRule, 'min_sessions_attended' | 'require_core_sessions' | 'require_final_project' | 'require_reflection' | 'is_approved'>;

/**
 * Mirrors issue_certificate() in the database so staff can see why someone is or is not ready. The database is the
 * authority: it re-checks everything when a certificate is issued. Without APPROVED rules nobody is eligible.
 */
export function evaluateEligibility(rule: RuleFields | null, f: CompletionFigures): Eligibility {
  if (!rule || !rule.is_approved) return { checks: [], eligible: false, blockedBy: 'no_approved_rules' };
  const checks: RuleCheck[] = [];
  if (rule.min_sessions_attended !== null) checks.push({ key: 'sessions', label: `Attended at least ${rule.min_sessions_attended} sessions (${f.sessionsAttended} so far)`, ok: f.sessionsAttended >= rule.min_sessions_attended });
  if (rule.require_core_sessions) checks.push({ key: 'core', label: `Attended all core sessions (${f.coreAttended} of ${f.coreTotal})`, ok: f.coreTotal > 0 && f.coreAttended >= f.coreTotal });
  if (rule.require_final_project) checks.push({ key: 'final', label: 'Submitted the final project', ok: f.finalSubmitted });
  if (rule.require_reflection) checks.push({ key: 'reflection', label: 'Submitted the reflection', ok: f.reflectionSubmitted });
  return { checks, eligible: checks.every((c) => c.ok), blockedBy: null };
}

export const publicVerifyUrl = (origin: string, certificateNo: string): string => `${origin}/verify?no=${encodeURIComponent(certificateNo)}`;

/** Certificate numbers look like DL-2026-000123. Anything else is rejected before a lookup. */
export const isCertificateNo = (s: string): boolean => /^DL-\d{4}-\d{6}$/.test(s.trim());
