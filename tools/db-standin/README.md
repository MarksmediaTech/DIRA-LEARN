# Local checking tools (used while `npm install` and Docker were unavailable)
For checking on a plain PostgreSQL 16 server (Linux; socket /tmp, port 54322, user postgres, trust auth). Never point them at Supabase.
- `../check-all.sh`: runs everything below in one go.
- `db_reset.sh <project>`: like `supabase db reset` (drops the LOCAL `postgres` database).  `db_test.sh <project>`: like `supabase test db`.
- `verify_rollback.sh <project> <N>`: proves rollback N returns the schema exactly to its earlier state.
- `crosscheck_results.ts`: database results = Results-page results.  `workflow_check.sql`: end-to-end workflows with the test accounts.
- `frontend_contract_check.py`: every database function/table/bucket the screens use exists and is reachable.
- `scanner_adapter_check.ts`: virus-scanner adapter against a local fake scanner.  `run_unit.sh`: pure-logic unit tests.
- `../typecheck-stubs/`: type-checks all screens against hand-written library definitions (baseline of known gaps in baseline.txt).
The real tools (`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `supabase test db`) remain the reference.
