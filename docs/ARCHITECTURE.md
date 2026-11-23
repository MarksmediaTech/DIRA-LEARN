# Architecture (Stage 1)

## Layers
Browser (React SPA) -> Supabase Auth (JWT) -> PostgREST with RLS -> PostgreSQL. Edge Functions handle only what RLS cannot: certificate PDF generation, CSV/PDF exports, notification dispatch, applicant-to-participant conversion, bulk operations. The service-role key is used only inside Edge Functions, never in the frontend.

## Authorisation model
- One role per user in `profiles.role` (enum of the 8 roles). Sign-up always creates `applicant`; a trigger blocks anyone but an active super admin from changing role, status or organisation.
- RLS is default-deny on every table. Scope rules: trainers see participants/cohorts they are assigned to; mentors see only assigned mentees; participants see only their own rows and only content for their cohort and track; applicants see only their own application; safeguarding records and audit logs are super-admin only.
- Sensitive fields live in separate tables (emergency contacts). Track selection and public certificate verification go through security-definer functions.

## Frontend structure (planned)
`src/features/<module>/{api,components,pages,schemas}`, `src/components/ui`, `src/lib/{supabase,auth,permissions}`, `src/routes`, tests alongside features, Playwright in `e2e/`. Curriculum is read from the database, never hardcoded.

## Build order
1 schema+RLS (written) -> 2 Vite scaffold + auth shell -> 3 applications/participants/cohorts/curriculum admin -> 4 learning modules -> 5 mentorship/M&E/reports/certificates/alumni -> 6 notifications/settings/audit -> 7 integration and E2E.
