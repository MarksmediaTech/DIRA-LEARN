# Change report: migration 37 and DIRA's 8 Nov 2026 Digital Marketing approval (21 Nov 2026)

**For review. Nothing deployed; no production migration run; the live database untouched.** Branch commit "Migration 37: Digital Marketing topics on their V13.2 sessions…" on top of `0db6a04`; not merged into main.

## 1. Decisions implemented (owner, 21 Nov 2026)

| Decision | Implemented as |
|---|---|
| Option A for the 11 Digital Marketing proposals | Migration 37 moves them to their V13.2 sessions, titles unchanged, and writes the 8 Nov approval into each description. **All 11 stay Pending**, to be approved in the Curriculum Approval Centre. |
| Digital Marketing records 3–8 stay Draft | `is_approved = false` on all six. Each gets a note naming the approved topics and outputs it carries forward. |
| Entrepreneurship Session 4 | Its 10 proposals stay Pending with no description. Its approved record is byte-identical. |

## 2. Result in the database

| Approved topic (DIRA, 8 Nov 2026) | Approved in | Now on | Status |
|---|---|---|---|
| Digital footprint and online safety | 5 | 3 | pending |
| Introduction to digital marketing | 5 | 3 | pending |
| Social media marketing (Facebook, Instagram, TikTok, LinkedIn) | 5 | 4 | pending |
| Content planning and creation | 5 | 5 | pending |
| Canva for marketing graphics | 6 | 5 | pending |
| Marketing copywriting, captions and calls to action | 6 | 6 | pending |
| WhatsApp Business | 6 | 4 | pending |
| Digital advertising fundamentals | 7 | 7 | pending |
| SEO fundamentals | 7 | 6 | pending |
| Marketing analytics and measuring campaign performance | 7 | 7 | pending |
| Developing a practical digital marketing strategy | 7 | 7 | pending |

**Unchanged:**
- 4 tracks: Digital Marketing, AI Tools, Content Creation, Entrepreneurship & Business.
- 26 session records: 2 core + 6 per track.
- Durations: 110, 115 and 24 × 120 minutes.
- 26 lesson plans, all Draft.
- 1 approved record (Entrepreneurship 4).
- 24 proposals, all pending.
- `programmes.is_approved = false`.
- No approval history rows.
- Nothing changed for AI Tools or Content Creation.

## 3. Files changed

**Production package:**

| File | Change |
|---|---|
| `supabase/migrations/20260101000037_digital_marketing_topic_sessions.sql` | **New.** The mapping function. `apply_digital_marketing_approval_37()`: re-maps, writes descriptions, aligns topics lists, adds notes; idempotent; refuses if any of the 11 was reviewed or is duplicated. Corrected `seed_initial_topic_proposals()` (other rows identical to migration 16). Runs the function once. Both new functions are service-role only. |
| `supabase/rollback/20260101000037_digital_marketing_topic_sessions_down.sql` | **New.** Restores sessions, descriptions, topics lists and notes exactly; restores the migration 16 function; drops the two functions. Refuses, changing nothing, if any of the 11 has been reviewed. It uses the **same four conditions as the forward migration**: `status <> 'pending'`, `reviewed_by IS NOT NULL`, `reviewed_at IS NOT NULL`, or a `curriculum_topic_events` row (`reviewed_by` added after review, section 6). |
| `supabase/seed.sql` | One added call to `apply_digital_marketing_approval_37()` after the V13 loaders. A fresh database gets its sessions from the seed, after the migrations. Produced by the curriculum generator. |
| `supabase/production_init/build_bundle.py` | Expects 37 migrations; header text. |
| `supabase/production_init/01_initialize_production.sql` | Regenerated: 37 migrations + seed, 1,719,889 bytes, SHA-256 `dcacb019…715415`. |
| `supabase/production_init/02_verify_readonly.sql` | Check 1 covers 01–37. Check 13 adds the exact four track names. Check 14 (rewritten): only Entrepreneurship 4 approved, 26 plans Draft, programme not approved, 24 proposals pending. **New check 15:** the 11 Digital Marketing topics on their exact V13.2 sessions, pending, with the approval in the description; records 3–8 draft with the note; Entrepreneurship 4 proposals untouched. **Bug fixed:** a check that could not be evaluated (NULL) showed FAIL but did not block `READY`; it now counts as failure. |
| `supabase/checks/expected_schema_fingerprint.txt` | Regenerated (2,278 lines). The only differences are migration 37's two new functions and the new `seed_initial_topic_proposals()` body. |
| `supabase/checks/live_migration_check_part2.sql` | Marker for 37. |
| `tools/curriculum/build_v13.py` | The generated seed ends with the migration 37 call after the V13 loaders, so the generator and `seed.sql` stay in sync. |
| `docs/ASSUMPTIONS_AND_DECISIONS.md` | Entry: **Approved by DIRA (owner, 8 Nov 2026)**, Sessions 5–7, with the exact wording, the approved topics and outputs, the scope, and how it is represented. |
| `docs/curriculum/DIGITAL_MARKETING_DIRA_APPROVAL_2026-11-08.md` | **New.** The approval, and where each approved topic and output is taught in V13.2 (retained, moved or changed), plus what V13.2 added that is not covered. |
| `docs/CURRICULUM_APPROVAL_CENTRE.md` | Starting queue: the Digital Marketing topics on Sessions 3–7, with the approval. Migration 37 listed. |
| `docs/deployment/PRODUCTION_DB_INITIALIZATION.md` | Migration table (37), counts, verification (15 checks), section 4a (approvals and how they are represented; the open question removed), rehearsal results. |
| `docs/deployment/CHANGE_REPORT_2026-11-21_MIGRATION_37.md` | This report. |

**Development checks** (not in the production package; included in the ZIP under `dev-checks/`):

| File | Change |
|---|---|
| `tools/release/migration37_check.sh` | **New.** 28 data-level checks (section 4), including the inconsistent-metadata regression tests (section 6). |
| `supabase/tests/digital_marketing_topics_37.test.sql` | **New** pgTAP, 16 assertions. |
| `supabase/tests/curriculum_v13.test.sql` | The assertion "applying V13 again changes nothing" now reads: it changes only the migration 37 notes on Digital Marketing records 3–8, and running the migration 37 function afterwards, as `seed.sql` does, restores every record exactly (plan 69 → 70). |
| `tools/release/production_init_check.sh` | Three negative tests: the verification must give NOT READY for a topic on an obsolete session, an approved lesson plan, and an approved V13.2 Digital Marketing record (16 → 19 checks). |
| `tools/check-all.sh` | Rollback 37; section 18 (migration 37 checks, expects 28/28); rehearsal expects 19/19. |
| `tools/release/references_check.py` | The rollback-presence range includes 37. |

**Not changed:** migrations 01–36 (byte-compared), `00_precheck_readonly.sql`, application code, Edge Functions, and the generated curriculum documents and YAML.

## 4. Test results (local PostgreSQL 16 stand-in, 21 Nov 2026)

| Check | Result |
|---|---|
| Fresh reset, 37 migrations + seed | applied |
| pgTAP database tests | **890 assertions, 0 failed** (incl. 16 for migration 37, 70 for V13) |
| Migration 37 data checks | **28/28**: fresh install and upgrade from 01–36 reach the identical state; re-runs of the function, migration and seed change nothing; nothing outside the 11 proposals and the Digital Marketing notes and topics changes (plans, other tracks, titles, outputs, durations, Entrepreneurship 4); a topic reviewed through the real Approval Centre function makes migration 37 refuse, unchanged; rollback restores the data exactly and refuses after a review; with inconsistent review metadata (`reviewed_by` set, `reviewed_at` NULL, no history event), rollback and migration 37 both refuse without change |
| Rollback schema checks 30–37 | all identical to the state before; re-apply OK |
| Production initialization rehearsal | **19/19**: guarded bundle on a production-like state, accounts untouched, schema equals the fingerprint, verification READY, three planted mistakes each give NOT READY, re-run refused, partial-failure resume |
| Curriculum generator | 10 generated files, 0 out of date |
| Curriculum upgrade and rollback | 41/41 |
| Unit tests | 353/353 |
| Type check | 0 new errors |
| Browser checks (registration, recovery, Edge Functions, CSP) | all passed |
| References | 603 checked, 0 missing, migrations 01–37 |
| **Full suite** (`tools/check-all.sh`) | **ALL AVAILABLE CHECKS PASSED** |

**Not run here:** the real Supabase platform and CLI, `npm ci`/build/ESLint with real packages, and Windows.

## 5. Checksums

| File | SHA-256 |
|---|---|
| `supabase/production_init/01_initialize_production.sql` (37 migrations + seed, 1,719,889 bytes) | `dcacb0191e5a7b5b9a86334f871df9ee224e9aeceba363495aa70f2b76715415` |

The bundle contains the migrations and the seed, not the rollback scripts, so the section 6 correction does not change it. It was regenerated and is byte-identical. The schema fingerprint is unchanged as well.

## 6. Correction after review (21 Nov 2026)

**Finding (owner review):** the rollback's refusal check tested `status`, `reviewed_at` and history events, but not `reviewed_by`. The forward migration tests all four.

**Fix:** `reviewed_by IS NOT NULL` was added to the rollback, so both scripts now use identical protection conditions.

**Regression tests** (`tools/release/migration37_check.sh`, section C):
- **Setup:** a Digital Marketing topic is given `reviewed_by` while `status` stays `pending`, `reviewed_at` stays NULL, and there is no history event. Migration 16's constraint `topic_review_fields` forbids this state, so the test drops that constraint in the local scratch database to simulate a drifted database.
- **Rollback 37** refuses with "rollback 37 refused: … Canva for marketing graphics (pending)".
- **Nothing changes after that refusal:** proposals, sessions, review fields, session records, lesson plans, other tracks, the three functions' code, and the history table (still 0 rows).
- **Migration 37's function** refuses the same state without change.
- **Proof the test guards the fix:** run against the uncorrected rollback, it fails (25/28). The old rollback moved the topic back from Session 5 to Session 6.

## 7. After initialization (in the app, by authorised people)

1. A Founder, Co-Founder or Super Administrator approves the 11 Digital Marketing topics in the Curriculum Approval Centre, with the comment "Approved by DIRA on 8 Nov 2026". Checks 14 and 15 then report them approved, which is expected.
2. The session records and lesson plans are approved separately when DIRA accepts the V13.2 wording and plans.
