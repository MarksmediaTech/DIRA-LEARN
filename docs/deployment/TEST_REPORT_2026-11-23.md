# Test report - 23 Nov 2026 (final). Real Chrome with simulated Supabase; no live service used

| Check | Result |
|---|---|
| tools/ui-theme/theme_check.mjs (real Chrome, project CSS, real CoverHero/LoginPage; desktop 1280, tablet 820, phone 390): panels, contrast, welcome ring/glow, original compositions kept, every photograph whole (four-corner markers, 6 photos x 3 sizes, welcome and sign-in), no zoom, no horizontal scroll | 131/131 PASS |
| Chat and notification screens (real app, simulated Supabase) | 24/24 PASS |
| Direct enrolment screens (CSV + Add learner), plain and production CSP | 26/26 + 26/26 PASS |
| Edge Functions in Chrome (simulated Supabase) | 61/61 PASS |
| Content-Security-Policy | 20/20 PASS |
| Password recovery screens, plain and CSP | 12/12 + 12/12 PASS |
| Registration/verification screens, plain and CSP | 13/13 + 13/13 PASS |
| First-admin setup / change password, plain and CSP | 11/11 + 11/11 PASS |
| Unit tests runnable without npm | 390/390 cases; 41 of 42 files pass; the 42nd is site.test.ts (needs Vite) |
| Type check with hand-written stubs | 0 new errors (19 known stub limitations; baseline refreshed) |
| Panel CSS in sync with its generator; routes (0 problems); file references (757, 0 missing); workflow YAML | PASS |

## Not run (and why)
- `npm ci` failed: no package registry. So real `tsc`, ESLint, Vitest, `vite build`, `npm audit` were NOT run.
- Component tests PhotoStage.test.tsx and CoverHero.test.tsx were rewritten but NOT executed (need Vitest). Their logic is covered only indirectly by theme_check in Chrome.
- site.test.ts (needs Vite).
- No PostgreSQL here: the database/pgTAP suite, the new migration 20261123000001 and its test, and tools/check-all.sh in full were NOT run. The new SQL is small but unexecuted.
- Chat was not rendered with the new theme in a screenshot; the Chat flow tests prove behaviour is unchanged, not appearance.
- Real DIRA photographs were not loaded (website unreachable); synthetic images were used.
- No test against real Supabase, Google or Cloudflare.
