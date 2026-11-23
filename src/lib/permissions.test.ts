import { canAccess, navFor, isStaffRole, EXECUTIVE_ROLES, NAV_GROUP_OF, NAV_ITEMS, groupedNavFor } from './permissions';
import { ROLE_CODES } from '@/types/database';

describe('applicant access before approval', () => {
  it('limits a pending or rejected applicant to the dashboard and their own application', () => {
    expect(navFor('applicant').map((i) => i.path)).toEqual(['/', '/application']);
  });
  it('keeps every participant-only and staff page closed to applicants', () => {
    for (const p of ['/tracks', '/resources', '/results', '/assignments', '/courses', '/projects', '/certificates', '/applications', '/users', '/audit', '/settings', '/import', '/emails']) {
      expect(canAccess('applicant', p)).toBe(false);
    }
  });
  // Updated in the V8 audit to the V3 executive rules (migration 17): Founder and Co-Founder are staff and executives.
  it('lets only staff roles open application management, and only executives open the audit log', () => {
    expect(ROLE_CODES.filter((r) => canAccess(r, '/applications')).sort()).toEqual(['co_founder', 'founder', 'programme_coordinator', 'programme_director', 'super_admin']);
    expect(ROLE_CODES.filter((r) => canAccess(r, '/audit')).sort()).toEqual(['co_founder', 'founder', 'super_admin']);
  });
});

describe('curriculum approval access', () => {
  it('gives the Curriculum Approval Centre to the Founder, Co-Founder and Super Administrator only', () => {
    expect(ROLE_CODES.filter((r) => canAccess(r, '/curriculum/approval'))).toEqual(['super_admin', 'founder', 'co_founder']);
    for (const r of ['programme_director', 'programme_coordinator', 'trainer', 'me_officer', 'mentor', 'participant', 'applicant'] as const) expect(canAccess(r, '/curriculum/approval')).toBe(false);
  });
  it('gives the Founder and Co-Founder the same navigation as the Super Administrator (board decision, migration 17)', () => {
    const superPaths = navFor('super_admin').map((i) => i.path);
    for (const r of ['founder', 'co_founder'] as const) {
      expect(navFor(r).map((i) => i.path)).toEqual(superPaths);
      expect(isStaffRole(r)).toBe(true);
      for (const p of ['/applications', '/users', '/settings', '/audit', '/safeguarding', '/curriculum/manage', '/import', '/emails', '/curriculum/approval']) expect(canAccess(r, p)).toBe(true);
    }
  });
  it('keeps the executive-only areas closed to every other role', () => {
    for (const r of ['programme_director', 'programme_coordinator', 'trainer', 'me_officer', 'mentor', 'participant', 'applicant'] as const) {
      for (const p of ['/users', '/settings', '/audit']) expect(canAccess(r, p)).toBe(false);
    }
  });
  // Migration 24: anyone working with learners can raise a concern; reading records is decided by the database (officers only).
  it('opens the Safeguarding page to staff, facilitators, mentors and M&E, never to learners or applicants', () => {
    for (const r of ['super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator', 'trainer', 'mentor', 'me_officer'] as const) expect(canAccess(r, '/safeguarding')).toBe(true);
    for (const r of ['participant', 'applicant'] as const) expect(canAccess(r, '/safeguarding')).toBe(false);
  });
  it('lists exactly three executive roles', () => { expect([...EXECUTIVE_ROLES]).toEqual(['super_admin', 'founder', 'co_founder']); });
});

describe('permissions', () => {
  it('lets every role see the dashboard', () => {
    for (const r of ROLE_CODES) expect(canAccess(r, '/')).toBe(true);
  });
  it('keeps applicants out of staff and learning pages', () => {
    for (const p of ['/attendance', '/curriculum', '/tracks']) expect(canAccess('applicant', p)).toBe(false);
  });
  it('only applicants see the application form', () => {
    expect(ROLE_CODES.filter((r) => canAccess(r, '/application'))).toEqual(['applicant']);
  });
  it('does not give mentors or participants attendance recording', () => {
    expect(canAccess('mentor', '/attendance')).toBe(false);
    expect(canAccess('participant', '/attendance')).toBe(false);
  });
  it('keeps application review staff-only and cohorts out of participant hands', () => {
    expect(canAccess('programme_coordinator', '/applications')).toBe(true);
    for (const r of ['trainer', 'participant', 'applicant', 'mentor', 'me_officer'] as const) expect(canAccess(r, '/applications')).toBe(false);
    expect(canAccess('trainer', '/cohorts')).toBe(true);
    expect(canAccess('participant', '/cohorts')).toBe(false);
  });
  it('gives trainers sessions but not curriculum management; staff get both', () => {
    expect(canAccess('trainer', '/sessions')).toBe(true);
    expect(canAccess('trainer', '/curriculum/manage')).toBe(false);
    expect(canAccess('participant', '/sessions')).toBe(false);
    expect(canAccess('programme_director', '/curriculum/manage')).toBe(true);
  });
  it('gives assignments to participants (submit), trainers and staff (grade) only', () => {
    for (const r of ['participant', 'trainer', 'programme_coordinator', 'super_admin'] as const) expect(canAccess(r, '/assignments')).toBe(true);
    for (const r of ['applicant', 'mentor', 'me_officer'] as const) expect(canAccess(r, '/assignments')).toBe(false);
  });
  it('keeps the resources page for participants (trainers add resources from the session page)', () => {
    expect(canAccess('participant', '/resources')).toBe(true);
    for (const r of ['applicant', 'trainer', 'mentor', 'me_officer', 'programme_coordinator'] as const) expect(canAccess(r, '/resources')).toBe(false);
  });
  it('gives results to participants (their own, by database rules), trainers and staff only', () => {
    for (const r of ['participant', 'trainer', 'programme_director', 'super_admin'] as const) expect(canAccess(r, '/results')).toBe(true);
    for (const r of ['applicant', 'mentor', 'me_officer'] as const) expect(canAccess(r, '/results')).toBe(false);
  });
  // Updated in the V8 audit to the V3 executive rules (migration 17). Role changes stay super-admin only in the database.
  it('keeps users, settings and the audit log for executives (super administrator, Founder, Co-Founder) only', () => {
    for (const p of ['/users', '/settings', '/audit']) {
      for (const r of EXECUTIVE_ROLES) expect(canAccess(r, p)).toBe(true);
      for (const r of ROLE_CODES.filter((x) => !EXECUTIVE_ROLES.includes(x))) expect(canAccess(r, p)).toBe(false);
    }
  });
  it('gives mentors only performance (their mentees), mentorship, calendar, safeguarding and Chat beyond the dashboard', () => {
    expect(navFor('mentor').map((i) => i.label)).toEqual(['Dashboard', 'Performance', 'Mentorship', 'Calendar', 'Safeguarding', 'Chat']);
  });
  it('limits M&E to the M&E officer and staff, and certificates to staff and participants', () => {
    expect(canAccess('me_officer', '/me')).toBe(true);
    expect(canAccess('trainer', '/me')).toBe(false);
    expect(canAccess('participant', '/certificates')).toBe(true);
    expect(canAccess('trainer', '/certificates')).toBe(false);
    expect(canAccess('applicant', '/chat')).toBe(false);
  });
  it('limits email to programme management and analytics to management and M&E', () => {
    expect(canAccess('programme_coordinator', '/emails')).toBe(true);
    for (const r of ['trainer', 'me_officer', 'mentor', 'participant', 'applicant'] as const) expect(canAccess(r, '/emails')).toBe(false);
    expect(canAccess('me_officer', '/analytics')).toBe(true);
    expect(canAccess('trainer', '/analytics')).toBe(false);
    expect(canAccess('applicant', '/calendar')).toBe(false);
  });
  it('gives courses to staff, trainers and participants only', () => {
    for (const r of ['super_admin', 'programme_director', 'programme_coordinator', 'trainer', 'participant'] as const) expect(canAccess(r, '/courses')).toBe(true);
    for (const r of ['me_officer', 'mentor', 'applicant'] as const) expect(canAccess(r, '/courses')).toBe(false);
  });
  it('limits learner import to programme management', () => {
    for (const r of ['super_admin', 'programme_director', 'programme_coordinator'] as const) expect(canAccess(r, '/import')).toBe(true);
    for (const r of ['trainer', 'me_officer', 'mentor', 'participant', 'applicant'] as const) expect(canAccess(r, '/import')).toBe(false);
  });
  it('denies unknown paths and missing roles', () => {
    expect(canAccess('super_admin', '/nope')).toBe(false);
    expect(canAccess(null, '/')).toBe(false);
  });
  it('builds navigation per role', () => {
    expect(navFor('participant').map((i) => i.label)).toEqual(['Dashboard', 'Choose a track', 'Curriculum', 'Resources', 'My Assignments', 'Results', 'Performance', 'Courses', 'Projects', 'Mentorship', 'Certificates', 'Alumni', 'Calendar', 'Chat']);
    expect(isStaffRole('trainer')).toBe(false);
    expect(isStaffRole('programme_coordinator')).toBe(true);
  });
});

describe('Daily Briefs page', () => {
  it('opens the management page to staff, executives and facilitators; the database decides who may actually publish', () => {
    for (const r of ['super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator', 'trainer'] as const) expect(canAccess(r, '/briefs')).toBe(true);
  });
  it('keeps the management page closed to learners, applicants, mentors and M&E', () => {
    for (const r of ['participant', 'applicant', 'mentor', 'me_officer'] as const) expect(canAccess(r, '/briefs')).toBe(false);
  });
});

describe('Chat and DIRA Connect moderation pages (22 Nov 2026)', () => {
  it('opens Chat to learners, all staff roles, mentors and M&E; the database decides what each can read and write', () => {
    for (const r of ['participant', 'trainer', 'mentor', 'me_officer', 'super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator'] as const) expect(canAccess(r, '/chat')).toBe(true);
  });
  it('keeps applicants out of Chat; there is no separate Notifications, Announcements or DIRA Connect page any more', () => {
    expect(canAccess('applicant', '/chat')).toBe(false);
    for (const p of ['/notifications', '/announcements', '/connect']) expect(navFor('super_admin').some((i) => i.path === p)).toBe(false);
  });
  it('shows moderation to staff and executives only; learners and facilitators never see it', () => {
    for (const r of ['super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator'] as const) expect(canAccess(r, '/connect/moderation')).toBe(true);
    for (const r of ['participant', 'trainer', 'mentor', 'me_officer', 'applicant'] as const) expect(canAccess(r, '/connect/moderation')).toBe(false);
  });
});

describe('Performance page (Phase 6)', () => {
  it('opens to learners, facilitators, mentors and staff; the database decides whose records each sees', () => {
    for (const r of ['participant', 'trainer', 'mentor', 'super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator'] as const) expect(canAccess(r, '/performance')).toBe(true);
    for (const r of ['me_officer', 'applicant'] as const) expect(canAccess(r, '/performance')).toBe(false);
  });
});

describe('Cohort Intelligence page (Phase 7)', () => {
  it('opens to programme staff, executives and M&E officers only', () => {
    for (const r of ['super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator', 'me_officer'] as const) expect(canAccess(r, '/intelligence')).toBe(true);
    for (const r of ['trainer', 'mentor', 'participant', 'applicant'] as const) expect(canAccess(r, '/intelligence')).toBe(false);
  });
});

describe('grouped navigation (Phase 9)', () => {
  it('puts every page in a group', () => {
    for (const i of NAV_ITEMS) expect(NAV_GROUP_OF[i.path] !== undefined).toBe(true);
  });
  it('shows each role exactly the pages it already had, once each, with no empty groups', () => {
    for (const r of ROLE_CODES) {
      const flat = groupedNavFor(r).flatMap((g) => g.items.map((i) => i.path));
      expect([...flat].sort()).toEqual(navFor(r).map((i) => i.path).sort());
      expect(new Set(flat).size).toBe(flat.length);
      for (const g of groupedNavFor(r)) expect(g.items.length > 0).toBe(true);
    }
  });
  it('keeps administration and insights away from learners', () => {
    expect(groupedNavFor('participant').map((g) => g.group)).toEqual(['Home', 'Learning', 'People and support']);
    expect(groupedNavFor('founder').map((g) => g.group)).toEqual(['Home', 'Learning', 'Programme', 'People and support', 'Insights', 'Administration']);
  });
});
