import type { AccountStatus, RoleCode } from '@/types/database';

/** Roles an administrator may hand out by hand. "participant" is only created by converting an accepted application. */
export const ASSIGNABLE_ROLES: readonly RoleCode[] = ['super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator', 'trainer', 'me_officer', 'mentor', 'applicant'];
export const ROLE_LABEL: Record<RoleCode, string> = {
  super_admin: 'Super administrator', founder: 'Founder', co_founder: 'Co-Founder', programme_director: 'Programme director', programme_coordinator: 'Programme coordinator', trainer: 'Trainer',
  me_officer: 'M&E officer', mentor: 'Mentor', participant: 'Participant', applicant: 'Applicant',
};

export function parseSettingValue(text: string): { value: unknown; error: string | null } {
  const t = text.trim();
  if (!t) return { value: null, error: 'Enter a value.' };
  try { return { value: JSON.parse(t), error: null }; } catch { return { value: null, error: 'The value must be valid JSON, for example true, 6, "text" or {"a": 1}.' }; }
}

export const formatSettingValue = (v: unknown): string => JSON.stringify(v, null, 2);

/** Names of top-level fields whose value differs between two audit snapshots. */
export function changedFields(oldData: Record<string, unknown> | null, newData: Record<string, unknown> | null): string[] {
  if (!oldData || !newData) return [];
  const keys = new Set([...Object.keys(oldData), ...Object.keys(newData)]);
  return [...keys].filter((k) => JSON.stringify(oldData[k]) !== JSON.stringify(newData[k])).sort();
}

export const ACTION_LABEL: Record<string, string> = { INSERT: 'Created', UPDATE: 'Changed', DELETE: 'Deleted' };

/** Account status labels and the reason rule of admin_set_account_status() (migration 34). */
export const STATUS_LABEL: Record<AccountStatus, string> = { active: 'Active', pending: 'Pending', deactivated: 'Deactivated' };
export function statusReasonProblem(reason: string): string | null {
  const n = reason.trim().length;
  return n < 10 || n > 500 ? 'Give a reason of 10 to 500 characters.' : null;
}

export function isEmail(s: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim()); }

export const SEVERITY_LABEL = { low: 'Low', medium: 'Medium', high: 'High' } as const;
