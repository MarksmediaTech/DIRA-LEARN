// Phase 9: the dashboard's "Needs your attention" list. Counts come from database functions that already limit what each
// person may see; this only decides which items to show and how to word them. Zero counts are not shown.

export interface AttentionCounts {
  gradingWaiting?: number; learnersNeedingSupport?: number; reportsOpen?: number; filesWaitingScan?: number;
  safeguardingOpen?: number; safeguardingOverdue?: number; concernsWithoutOfficer?: number;
}
export interface AttentionItem { key: string; text: string; to: string; urgent: boolean }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Which counts a role should load (keeps the dashboard from asking for figures the person cannot see anyway). */
export function attentionSources(role: string | null | undefined, isOfficer: boolean): (keyof AttentionCounts)[] {
  const out: (keyof AttentionCounts)[] = [];
  if (role === 'trainer') out.push('gradingWaiting', 'learnersNeedingSupport');
  if (['super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator'].includes(role ?? '')) out.push('learnersNeedingSupport', 'reportsOpen', 'filesWaitingScan');
  if (['super_admin', 'founder', 'co_founder'].includes(role ?? '')) out.push('concernsWithoutOfficer');
  if (isOfficer) out.push('safeguardingOpen', 'safeguardingOverdue');
  return out;
}

export function attentionItems(c: AttentionCounts): AttentionItem[] {
  const items: AttentionItem[] = [];
  const n = (v: number | undefined) => v ?? 0;
  if (n(c.concernsWithoutOfficer) > 0) items.push({ key: 'no-officer', urgent: true, to: '/safeguarding', text: `${plural(n(c.concernsWithoutOfficer), 'safeguarding concern is', 'safeguarding concerns are')} waiting and no Safeguarding Lead or Deputy is appointed` });
  if (n(c.safeguardingOverdue) > 0) items.push({ key: 'sg-overdue', urgent: true, to: '/safeguarding', text: `${plural(n(c.safeguardingOverdue), 'safeguarding concern has', 'safeguarding concerns have')} passed the acknowledgement target` });
  if (n(c.safeguardingOpen) > 0) items.push({ key: 'sg-open', urgent: false, to: '/safeguarding', text: `${plural(n(c.safeguardingOpen), 'safeguarding concern is', 'safeguarding concerns are')} not yet acknowledged` });
  if (n(c.reportsOpen) > 0) items.push({ key: 'reports', urgent: false, to: '/connect/moderation', text: `${plural(n(c.reportsOpen), 'DIRA Connect report is', 'DIRA Connect reports are')} waiting for a moderator` });
  if (n(c.gradingWaiting) > 0) items.push({ key: 'grading', urgent: false, to: '/assignments', text: `${plural(n(c.gradingWaiting), 'piece of work is', 'pieces of work are')} waiting for your grade` });
  if (n(c.learnersNeedingSupport) > 0) items.push({ key: 'support', urgent: false, to: '/performance', text: `${plural(n(c.learnersNeedingSupport), 'learner may', 'learners may')} need support` });
  if (n(c.filesWaitingScan) > 0) items.push({ key: 'scan', urgent: false, to: '/connect/moderation', text: `${plural(n(c.filesWaitingScan), 'shared file is', 'shared files are')} waiting for a virus check` });
  return items;
}
