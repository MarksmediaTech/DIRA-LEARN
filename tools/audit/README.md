Audit of 20 Nov 2026 (docs/deployment/AUDIT_REPORT_2026-11-20.md). DISPOSABLE local database only - never a live project.
1. Build a database named `audit` from the package's migrations and seed, then load supabase/local_test_accounts.sql.
2. psql -d audit -f seed_audit.sql      plants test records (triggers bypassed; audit database only)
3. ./matrix.sh                           who can read which planted records, per role
4. bash attacks.sh; bash attacks2.sh     unauthorised writes by active accounts (all must say "ok")
5. Set trainer.a and learner1 to status 'deactivated', then bash attacks3.sh  (finding H1: all "ok" since migration 34)
