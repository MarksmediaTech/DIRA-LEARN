# Executive roles: Super Administrator, Founder, Co-Founder (migration 17)

Status: written, **not run** (no Postgres, Node packages or network were available). Follow "Safe rollout" before relying on it.

## What changed
Founder and Co-Founder now have administrative access equivalent to the Super Administrator, as required by the board's master instruction (Phase 8). This replaces the earlier rule that they were "not general staff".

| Area | Super Admin | Founder / Co-Founder | Other staff |
|---|---|---|---|
| Staff areas (applications, cohorts, attendance, results, import, email) | yes | yes (now) | per role |
| Settings, Audit log, Safeguarding | yes | yes (now) | no |
| Users: view all accounts | yes | yes (now) | no |
| Users: change role/status, invite staff | yes | **no** (see decision 1) | no |
| Curriculum edit/approve, certificates, application decisions | yes | yes (now) | per role |
| Curriculum Approval Centre | yes | yes | no |

## How it is enforced
- Database: new `is_executive()`; `is_staff()` now includes the two roles; policies for settings, audit, safeguarding, reference/curriculum tables, certificates, M&E and graduation rules use `is_executive()`; hard-coded role lists in curriculum, certificate, application-decision, user-list and bulk-email functions were extended (the migration aborts if any expected text is not found).
- `is_admin()` is **unchanged** (super admin only). It still guards role/status/organisation changes, the profiles write policy and the "last super administrator" protection.
- The first-administrator bootstrap (`claim_first_admin`, `/setup`) is untouched.
- Edge Functions: `convert-application`, `import-learners`, `send-emails` accept the executive roles. `invite-user` stays super-admin only.
- Frontend: `src/lib/permissions.ts` (`EXECUTIVE_ROLES`), Users page read-only for non-super-admins, course/certificate/curriculum/application rules. These only shape the screens; the database is the real control.

## Decisions needed from DIRA management (not guessed)
1. **Who may assign roles?** Today only a Super Administrator can invite staff or change roles and status, so a Founder cannot create another administrator. If Founders should assign roles too, say which roles (for example everything except super_admin) and the guards will be extended.
2. **Safeguarding access.** ~~Executives can now read and write safeguarding records.~~ **Settled 19 Nov 2026 (migration 24):** only the designated Safeguarding Lead and Deputy can read or change records; executives appoint them and can see that concerns are waiting. See `docs/SAFEGUARDING.md`.
3. **Audit log and settings** are now visible to Founder and Co-Founder. Confirm.

## Safe rollout
1. Back up the Supabase database.
2. Local: `supabase start && supabase db reset && supabase test db`. `supabase/tests/executive_roles.test.sql` (18 checks) must pass, together with the existing tests. `curriculum_approval.test.sql` was updated: a founder is now staff and executive, but not `is_admin()`.
3. `npm install && npm run typecheck && npm run lint && npm test && npm run build`.
4. Staging copy, then production after approval: `supabase db push` (applies 17), then `supabase functions deploy convert-application import-learners send-emails`.
5. Rollback: re-create the previous definitions from migrations 2, 5, 9, 10, 14 (the policies and functions listed above). There is no data change to undo.
