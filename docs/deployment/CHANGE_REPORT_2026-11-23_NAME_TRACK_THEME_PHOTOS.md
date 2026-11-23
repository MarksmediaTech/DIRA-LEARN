# Change report - full names, saved track, purple glowing panels, photographs, certificate name (23 Nov 2026, final)

Status: implemented and tested locally only. **Nothing deployed, no migration applied, no Edge Function deployed, no Google, Supabase or Cloudflare setting changed, nothing pushed to GitHub.** Chat, notification bell, Google Calendar sync and direct enrolment (CSV `name,email,programme_track`, first-password activation, no approval step) are unchanged except for the Chat panel styling in section 1D.

## 1. What changed
**A. Complete name kept whole** (earlier in this release). `splitName` removed from `src/features/import/rules.ts` and the `import-learners` Edge Function. The whole name is saved in `first_name`; `last_name` stays empty (no migration needed).

**B. Saved track preselected on cohort assignment** (earlier in this release). `CohortDetailPage.tsx`, `cohorts/rules.ts`. Staff can change it. Needs pending migration 20261122000001; without it nothing is preselected and the page still works.

**C. Certificate check shows the complete name (new).** The public check page showed "first name + initial + full stop", so a whole name would read "Brian Njima Otieno .". New pending migration `supabase/pending/20261123000001_verify_certificate_full_name.sql` replaces only the body of `verify_certificate(text)` (same inputs, outputs and permissions). Whole name -> shown exactly; older split names -> first name + full surname. Undo file included. The note on `VerifyPage.tsx` was reworded. **Privacy effect:** anyone with a valid certificate number now sees the full name (before: first name and an initial). **Until this migration is applied the page still shows the extra " ."**

**D. Purple glowing panels, now also on Chat (new).** The Chat screen is no longer opted out. Outer panels (conversation list, open conversation, announcement cards and composer, file cards, empty states) use `dira-panel`. Message bubbles, status colours and the unread badge colours are kept (bubbles are light surfaces, which the theme leaves dark-on-light; badge text uses a fixed dark colour). Highlighted announcements/messages (deep links) also get an outline because the panel glow would hide the ring. Programme-arc week cards keep their progress and completion colours (not touched).

**E. Photographs - original compositions restored (new).** The side-by-side framed photo (`PhotoFrame`) is removed. Welcome panel: photographs behind the greeting as before, each shown whole (object-contain, no zoom), on the right of the greeting from tablet width up, with a purple fade only under the text; on phones the whole photograph sits behind the text under a purple tint. Sign-in page: photographs behind the page as before, shown whole; no photo in the content. `PhotoLayers` gained an `align` option. **The original files were not in the transfer, so these were rebuilt from the tests, docs and shared components: please compare with GitHub `main` in the pull request.** Real photographs could not be loaded here; checks used synthetic images with coloured corner markers.

## 2. Modified files (this final round, on top of the 22/23 Nov work)
src/features/certificates/VerifyPage.tsx; src/features/chat/ChatPage.tsx, ThreadView.tsx, Announcements.tsx; src/components/ui/PhotoStage.tsx, PhotoStage.test.tsx; src/features/dashboard/CoverHero.tsx, CoverHero.test.tsx; src/features/auth/LoginPage.tsx; tools/ui-theme/theme_check.mjs, harness-theme.tsx; tools/recovery/browser/build-css.mjs (test tool: arbitrary-value classes were not found); tools/typecheck-stubs/baseline.txt (2 old entries gone).
New: supabase/pending/20261123000001_verify_certificate_full_name.sql and _rollback.sql; supabase/tests-pending/verify_certificate_full_name.test.sql; supabase/pending/README.md updated.
Earlier in this release: src/features/import/rules.ts, rules.test.ts; supabase/functions/import-learners/index.ts; src/features/cohorts/CohortDetailPage.tsx, rules.ts, rules.test.ts; src/index.css; tools/edge-browser/run.mjs; tools/ui-theme/generate-panel-css.mjs.

## 3. Outstanding
1. Pending migrations, in order, all unapplied: 20261122000001 (saved track), 20261122000002 (Chat/calendar), 20261123000001 (certificate name, independent of the other two).
2. Compare CoverHero/LoginPage/PhotoStage with `main` (originals missing).
3. Look at the Chat screen in a browser (theme verified by code reading and the unchanged Chat flow tests only, not by a themed screenshot).
4. Run on your computer: `npm ci && npm run typecheck && npm run lint && npm test && npm run build`.
5. Decide whether showing the full name on the public certificate check is acceptable.
