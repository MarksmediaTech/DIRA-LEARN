import type { RoleCode } from '@/types/database';

export type NavGroup = 'Home' | 'Learning' | 'Programme' | 'People and support' | 'Insights' | 'Administration';
export const NAV_GROUPS: readonly NavGroup[] = ['Home', 'Learning', 'Programme', 'People and support', 'Insights', 'Administration'];
export interface NavItem { label: string; path: string; roles: readonly RoleCode[] }

// Executive roles have equivalent administrative access (must match is_executive() in the database, migration 17).
export const EXECUTIVE_ROLES: RoleCode[] = ['super_admin', 'founder', 'co_founder'];
const STAFF: RoleCode[] = [...EXECUTIVE_ROLES, 'programme_director', 'programme_coordinator'];
// May approve or reject proposed curriculum topics (must match can_approve_curriculum() in the database).
export const CURRICULUM_APPROVERS: RoleCode[] = ['super_admin', 'founder', 'co_founder'];

// Frontend routing only. Real authorisation is enforced by Row Level Security in PostgreSQL.
export const NAV_ITEMS: readonly NavItem[] = [
  { label: 'Dashboard', path: '/', roles: [...STAFF, 'trainer', 'me_officer', 'mentor', 'participant', 'applicant'] },
  { label: 'My application', path: '/application', roles: ['applicant'] },
  { label: 'Choose a track', path: '/tracks', roles: ['participant'] },
  { label: 'Curriculum', path: '/curriculum', roles: [...STAFF, 'trainer', 'me_officer', 'participant'] },
  { label: 'Resources', path: '/resources', roles: ['participant'] },
  { label: 'Manage curriculum', path: '/curriculum/manage', roles: STAFF },
  { label: 'Curriculum Approval Centre', path: '/curriculum/approval', roles: CURRICULUM_APPROVERS },
  { label: 'Sessions', path: '/sessions', roles: [...STAFF, 'trainer'] },
  { label: 'Assignments', path: '/assignments', roles: [...STAFF, 'trainer', 'participant'] },
  { label: 'Results', path: '/results', roles: [...STAFF, 'trainer', 'participant'] },
  // Phase 6: individual performance. The database decides whom each person sees (migration 27).
  { label: 'Performance', path: '/performance', roles: [...STAFF, 'trainer', 'mentor', 'participant'] },
  { label: 'Applications', path: '/applications', roles: STAFF },
  { label: 'Cohorts', path: '/cohorts', roles: [...STAFF, 'trainer'] },
  { label: 'Attendance', path: '/attendance', roles: [...STAFF, 'trainer'] },
  { label: 'Courses', path: '/courses', roles: [...STAFF, 'trainer', 'participant'] },
  { label: 'Projects', path: '/projects', roles: [...STAFF, 'trainer', 'participant'] },
  { label: 'Mentorship', path: '/mentorship', roles: [...STAFF, 'mentor', 'participant'] },
  { label: 'Certificates', path: '/certificates', roles: [...STAFF, 'participant'] },
  { label: 'Alumni', path: '/alumni', roles: [...STAFF, 'me_officer', 'participant'] },
  { label: 'M&E', path: '/me', roles: [...STAFF, 'me_officer'] },
  { label: 'Calendar', path: '/calendar', roles: [...STAFF, 'trainer', 'me_officer', 'mentor', 'participant'] },
  { label: 'Analytics', path: '/analytics', roles: [...STAFF, 'me_officer'] },
  // Phase 7: aggregates for staff and M&E; individual learners and facilitators for staff only (migration 28).
  { label: 'Cohort Intelligence', path: '/intelligence', roles: [...STAFF, 'me_officer'] },
  { label: 'Email', path: '/emails', roles: [...STAFF] },
  { label: 'Add learners', path: '/import', roles: [...STAFF] },
  { label: 'Users', path: '/users', roles: EXECUTIVE_ROLES },
  { label: 'Settings', path: '/settings', roles: EXECUTIVE_ROLES },
  { label: 'Audit log', path: '/audit', roles: EXECUTIVE_ROLES },
  // Everyone who works with learners can RAISE a concern here; only the designated Safeguarding Lead and Deputy can READ records
  // (enforced by the database, migration 24). Executives see the officer appointments, not the records.
  { label: 'Safeguarding', path: '/safeguarding', roles: [...STAFF, 'trainer', 'mentor', 'me_officer'] },
  { label: 'Daily Briefs', path: '/briefs', roles: [...STAFF, 'trainer'] },
  // Programme staff may be appointed safeguarding officers, so they can open Connect; the database decides what anyone reads.
  // 22 Nov 2026: Chat replaces DIRA Connect, Announcements and Notifications (notifications: the bell in the header)
  { label: 'Chat', path: '/chat', roles: [...STAFF, 'trainer', 'me_officer', 'mentor', 'participant'] },
  { label: 'Connect moderation', path: '/connect/moderation', roles: STAFF },
];

// Phase 9: where each page sits in the grouped menu. Grouping changes only the display, never who can open a page.
export const NAV_GROUP_OF: Record<string, NavGroup> = {
  '/': 'Home',
  '/application': 'Home',
  '/chat': 'Home',
  '/calendar': 'Home',
  '/tracks': 'Learning',
  '/curriculum': 'Learning',
  '/resources': 'Learning',
  '/assignments': 'Learning',
  '/results': 'Learning',
  '/performance': 'Learning',
  '/courses': 'Learning',
  '/projects': 'Learning',
  '/certificates': 'Learning',
  '/curriculum/manage': 'Programme',
  '/curriculum/approval': 'Programme',
  '/sessions': 'Programme',
  '/applications': 'Programme',
  '/cohorts': 'Programme',
  '/attendance': 'Programme',
  '/import': 'Programme',
  '/briefs': 'Programme',
  '/emails': 'Programme',
  '/mentorship': 'People and support',
  '/alumni': 'People and support',
  '/connect/moderation': 'People and support',
  '/safeguarding': 'People and support',
  '/intelligence': 'Insights',
  '/analytics': 'Insights',
  '/me': 'Insights',
  '/users': 'Administration',
  '/settings': 'Administration',
  '/audit': 'Administration',
};

/** The role's menu in groups, in NAV_GROUPS order, items in their usual order, empty groups left out. */
export function groupedNavFor(role: RoleCode): { group: NavGroup; items: NavItem[] }[] {
  const items = navFor(role);
  return NAV_GROUPS.map((group) => ({ group, items: items.filter((i) => (NAV_GROUP_OF[i.path] ?? 'Home') === group) })).filter((g) => g.items.length > 0);
}

// Learners see "My Assignments"; staff keep "Assignments". The path and access rule are the same.
export function navFor(role: RoleCode): NavItem[] {
  return NAV_ITEMS.filter((i) => i.roles.includes(role)).map((i) => (role === 'participant' && i.path === '/assignments' ? { ...i, label: 'My Assignments' } : i));
}

export function canAccess(role: RoleCode | null | undefined, path: string): boolean {
  if (!role) return false;
  const item = NAV_ITEMS.find((i) => i.path === path);
  return item ? item.roles.includes(role) : false;
}

export const isStaffRole = (role: RoleCode) => STAFF.includes(role);
