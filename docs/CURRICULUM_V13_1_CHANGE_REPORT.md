# DIRA LEARN V13.1 – review refinements to the 26 lesson plans

Revised 19 Nov 2026, after the programme review. **The five requested refinements and a stretch break in every 120-minute track session are in place, with no session added and no date, week or duration changed.** All 26 lesson plans remain drafts, ready for approval. Nothing has been deployed, and the live Supabase project has not been touched.

## 1. What changed

| # | Request | Change |
|---|---|---|
| 1 | Safeguarding (core session 1) | The session no longer names or implies a Safeguarding Lead or Deputy. Facilitators share only the support contacts and appointments that programme management has formally confirmed for the cohort, and never name someone who has not been appointed. The same wording is used in core session 2 and in the assessment guidance. |
| 2 | Consent and public posting | Every track's final project now has a **privacy option**: a private test, a private or link-only portfolio, a DIRA LEARN-only submission, or a simulated brief. It is assessed with the same rubric. Written permission (a WhatsApp message is enough) is required before using identifiable people, photographs, or a business's name, logo, prices or customer information, and children are never photographed. Private alternatives sit beside each publishing task: core 2; Digital Marketing 3, 5, 6 and 7; AI Tools 3, 5 and 6; Content Creation 3, 5 and 7; Entrepreneurship & Business 3 and 7. A consent and privacy instruction for facilitators is in sessions 3, 5 and 7 of every track and in core session 2. |
| 3 | Showcase capacity (session 8) | The 60 minutes of presentations are kept, as two 30-minute blocks. Each room holds at most 12 presenters (3 minutes plus 2 minutes of questions). The room plan is set in session 7 from the group size. The recorded option (video, or a voice note with slides for low data) is open to large groups and anyone who cannot present live. A visible timer is used, and questions are cut to 1 minute if a block runs late; the session is never extended. The full room plan is in the session 8 facilitator notes. |
| 4 | Entrepreneurship finance (session 5) | The terms are now used consistently (see the definitions below). A formula card is added, and the assessment questions and template match. |
| 5 | Accessibility (AI Tools and Content Creation) | Every session lists free or low-cost tools and a low-data option: free tiers, built-in phone apps, paper alternatives, downloads on programme Wi-Fi, 720p exports, and voice-note demos. Every session also has a shared-device arrangement (pairs or threes with rotating roles), and no paid tool or plan is ever required. |
| – | Stretch break | There is one 5-minute stretch break, with a seated option, near the middle of each of the 24 track sessions. The 5 minutes come from a longer practical activity in the same session, or in session 8 from the feedback round (15 to 10 minutes), so totals stay 120. The core sessions (110 and 115 minutes) keep their approved flow. |

**Session 5 finance definitions.** The juice example, checked by arithmetic, uses KES 80 as the price, KES 4,000 a month in fixed costs and 300 bottles sold:
- **Variable cost per unit** = KES 50, the sum of the costs of one bottle.
- **Contribution per unit** = price − variable cost per unit = KES 30. The contribution margin is 37.5% of the price, which is not the same as a 60% markup on cost.
- **Gross profit** = revenue − cost of goods sold = KES 9,000. Here it equals total contribution only because every variable cost is a product cost; the lesson explains when the two differ.
- **Fully allocated unit cost** = variable cost per unit + fixed costs ÷ units = about KES 63 at 300 bottles.
- **Break-even** = fixed costs ÷ contribution per unit = 134 bottles, at which point the fully allocated unit cost is about the price.
- **Net profit** = KES 5,000.

## 2. What did not change

- 4 weeks and 8 sessions, with durations of 110, 115 and 24 × 120 minutes. Weeks, dates and timetable allocations are unchanged.
- The approved lesson content. Entrepreneurship & Business session 4's approved record is unchanged.
- The 11 pending Digital Marketing topics are still pending.
- Approval permissions and audit records are unchanged.

## 3. How it reaches the database

- **New migration** `20260101000031_curriculum_v13_1.sql`, with rollback `supabase/rollback/20260101000031_curriculum_v13_1_down.sql`.
- **Migration 30 is unchanged.** It was delivered, so it is now frozen and checked by SHA-256.
- **Draft plans still at the V13 text** are updated to V13.1, plan and notes together.
- **Plans edited or approved since V13** are kept as they are and reported.
- **A fresh database** gets V13.1 directly.

## 4. Validation and regression tests (local; browser, Windows and live Supabase not used)

| Check | Result |
|---|---|
| Curriculum content check: original rules plus 6 new refinement checks | 0 problems. The same checks report 80 problems on the pre-review source. |
| Durations and segment totals | All 26 equal the timetable |
| Database tests (11 new V13.1 tests) | 762/762 |
| Upgrade: pre-V13 → V13 → V13-era edits and approval → V13.1 → rollback 31 → rollback 30 → re-apply | 37/37 |
| Schema rollback 30 and 31; re-apply | Identical; OK |
| End-to-end workflows as the test accounts; unit tests; type check; frontend contract | 36/36; 325/325; 0 new errors; 0 problems |

## 5. Next step

Approve the lesson plans in **Manage curriculum → Approve lesson plan**. This uses the existing session approvers: Super Administrator, Founder, Co-Founder and Programme Director. The Curriculum Approval Centre screen handles topic proposals (including the 11 pending Digital Marketing topics) and does not list lesson plans, so it was left unchanged.

## 6. V13.2 – final refinements authorised at approval (19 Nov 2026, migration 32)

- **AI Tools session 4:**
  - Names the free AI tools: free tiers of ChatGPT, Gemini, Copilot and Claude, plus Perplexity for cited answers.
  - Gives a no-account alternative: Duck.ai (no account, email or phone number; daily limit). ChatGPT and Perplexity can also be used logged out, and the shared screen is the fallback.
  - The facilitator tests on the venue network beforehand which tools work without signing in.
  - No learner is required to create an account.
- **Content Creation:**
  - Portfolio submissions use a restricted-access link (named reviewers only, for example a Google Drive folder set to "Restricted") or files uploaded in DIRA LEARN. Public or "anyone with the link" links are never used.
  - This is reflected in the final project, the session 7 activity, tools and facilitator check, the session 8 homework and instructions, and the session 5 private-sharing option.
  - A public portfolio stays the learner's own optional choice, after consent checks.
- **Migrations:** migrations 30 and 31 are frozen and checked by SHA-256. Migration 32 updates drafts that are still exactly at the V13.1 text, and keeps and reports anything else. Its rollback is `supabase/rollback/20260101000032_curriculum_v13_2_down.sql`.
- **Tests:**
  - content check: 0 problems, including the new final-review checks;
  - database: 766/766;
  - upgrade V13 → V13.1 → V13.2 plus three rollbacks: 41/41;
  - rollbacks 30–32: schema identical;
  - end-to-end: 36/36;
  - unit tests: 325/325;
  - type check: 0 new errors.
- **Approval:** not recorded by this work. See the final report.

