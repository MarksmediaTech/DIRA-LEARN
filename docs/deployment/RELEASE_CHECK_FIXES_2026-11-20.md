# DIRA LEARN – release-check corrections (branch `fix/production-release-readiness`)

**Date:** 20 Nov 2026. **Input:** the GitHub Actions release-check of 20 Nov 2026 04:40 UTC (`release-check-report.md/.json`,
`package-lock.json`). **Not done:** no merge, no deployment, no database migration or change, no secret touched, no curriculum
status changed, no dependency major upgrade applied (see §4 for why and the tested plan).

**Access in the session that prepared this:** no GitHub access (the branch was prepared locally and delivered as a patch and a
folder) and no npm registry. Checks marked *executed* below were run; the official `npm ci / typecheck / lint / build / audit`
must be re-run by the release-check workflow on the branch.

## 1. ESLint – 26 errors, 2 warnings → expected 0

| Finding | Cause | Change | Verified |
|---|---|---|---|
| 23 × `no-undef` (`Buffer`, `process`, `console`, `URL`) in `scripts/release-check.mjs`, `scripts/write-headers.mjs` | the config treats every file as browser code; these two scripts run in Node.js at build time | `eslint.config.js`: a block for `scripts/**/*.mjs` declaring exactly those four Node globals. Browser code keeps the browser environment; no rule disabled | core ESLint 10.1.0 (offline): the unchanged source gives these 23 errors at the reported line:column; the fixed source 0 |
| `no-control-regex` in `src/features/import/rules.ts:25` | the CSV import removes control characters with a regex containing `\u0000-\u001F` | same behaviour as a character filter (`isControl`), no control-character regex | core ESLint: 1 → 0. New unit test compares the new function with the old regex on 600 inputs (all control characters, Unicode, emoji): identical |
| 2 × `no-irregular-whitespace` in `src/features/intelligence/rules.ts:62`, `src/features/performance/PerformancePage.tsx:79` | an invisible byte-order mark (U+FEFF) typed directly into the CSV-export template string (it makes Excel open the CSV as UTF-8) | written as the escape `﻿`: the produced file is byte-for-byte the same | raw-file check: U+FEFF exactly at the reported columns before, none after |
| 2 × `react-hooks/exhaustive-deps` warnings in `ApprovalCenterPage.tsx:37` | `rows = q.data?.rows ?? []` made a new array every render, so the three memos recomputed every render | `rows` is memoised on `q.data?.rows` | by reading (the React Hooks plugin is not available offline); behaviour unchanged, fewer recomputations |

## 2. "Server secret" in `assets/index-BPvBBVup.js`

**What could be established without the built file.** The scanner fired on one of `service_role`, `SUPABASE_SERVICE_ROLE_KEY`,
`sb_secret_`, `-----BEGIN … PRIVATE KEY` or `re_` + 20 letters/digits. None of these strings exists anywhere in the DIRA LEARN
source (`src/`), and the frontend reads only `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_PUBLIC_SITE_URL`, so the
match comes from third-party code bundled into the single chunk (`@supabase/supabase-js` 2.119.2, recharts, React Router, Zod …)
– most likely a library naming a key type – or from an identifier containing `re_`. **The exact text and its library could not be
identified here**, because the bundle cannot be rebuilt without the npm registry, and the old scanner did not print it.

**Scanner rewritten (stricter, not weaker)** – `scripts/release-check.mjs`:
- Every finding now reports rule, `file:line:column`, the matched text with any key-shaped part **masked** (prefix + length),
  the surrounding code (also masked), and a fingerprint.
- When a finding is not reviewed, the script rebuilds the same code **with source maps into a temporary folder** and names the
  **original source file and line** (e.g. `node_modules/@supabase/auth-js/…:123`). Nothing extra is published.
- **Secret rules** match the shape of real credentials and always fail, cannot be allowlisted: private keys, `sb_secret_` + key
  body, Resend `re_…` keys, live Stripe keys, a value assigned to `SUPABASE_SERVICE_ROLE_KEY`, and any Supabase JWT whose role is
  not `anon` (decoded). The Resend rule now requires `re_` to start a token, so identifiers like `signature_…` no longer trigger it,
  but a real `re_…` key (also with underscores) still does.
- **Mention rule** (`service_role`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `sb_secret_` without a key body) still
  **fails** until a person reviews that exact occurrence and records it in `scripts/secret-scan-allowlist.json` (fingerprint,
  source, reason ≥ 20 characters, reviewer, date). The fingerprint covers the surrounding code, so a library update is reviewed again.
- The allowlist is **empty**. The next workflow run will therefore still fail at this step, but print exactly what matched and
  where. Then: if it is a real key → rotate it in Supabase and remove it; if it is a library naming a key type → add the reviewed
  entry. Executed self-tests: 26/26 (real keys fail and are masked; real keys cannot be allowlisted; a library mention fails until
  reviewed; the original file and line are found through a real minified, source-mapped esbuild bundle).

## 3. Production dependencies (npm audit --omit=dev): high 1, moderate 2 – **not fixed, documented**

| Package (locked) | Advisory | Fixed in | Reachable in DIRA LEARN? |
|---|---|---|---|
| zod 3.25.76 (high) | GHSA-mrhx-c7xc-m3w5 / CVE-2023-54404: memory exhaustion when an attacker submits a huge array to an **array schema without a length limit** | zod ≥ 4.6.6 (no 3.x fix) | **No known path.** The app has no `z.array` schema; Zod runs only in the user's own browser on three forms (application, cohort, session schedule) with fixed fields and length limits. A user could only slow their own browser tab |
| react-router 6.30.6 / react-router-dom (moderate) | GHSA-wrjc-x8rr-h8h6 / CVE-2026-53669: open redirect via backslash when **attacker-controlled destinations** reach `<Link>`/`useNavigate`; GHSA-337j-9hxr-rhxg: SSR hydration (`deserializeErrors`) | react-router 7.18.0 (no 6.x fix) | **No known path.** Every `<Link>`, `<NavLink>`, `<Navigate>` and `navigate()` target is a fixed internal path from the code (menu, dashboard, notification types); the only URL input (`?code=` on the certificate check) is never used as a destination. The SSR advisory does not apply (client-side app, no SSR) |

These remain real findings and the release-check still (correctly) fails on the Zod "high". The upgrades are majors and could not be
installed or built here; changing `package.json` without regenerating `package-lock.json` would break `npm ci`. They are planned
as a separate, tested change (§4) for your decision.

## 4. Tested upgrade plan (separate branch after this one)

**Zod 3 → 4.6.7 (+ @hookform/resolvers 3 → 5, which is required for Zod 4).** Executed here: the three form schemas were run on
Zod 3 and, converted, on the Zod 4 engine that ships inside zod 3.25 (`zod/v4`), with 37 inputs (`tools/release/zod4_compat.mjs`):
- With `z.string().uuid()` kept, Zod 4 **rejects valid ids** that are accepted today (non-RFC ids such as the seeded programme
  `00000000-…-0000000000a1` and fixed staff ids) → use **`z.guid()`** for all id fields. With that, every input is accepted or
  rejected exactly as today.
- Default messages change from plain language to technical text ("Required" → "Invalid input: expected string, received undefined";
  "Choose a preferred track" → "Invalid input"; max/enum messages) → give these fields explicit messages.
- Syntax: `{ invalid_type_error: '…' }` and `{ errorMap: () => ({ message: '…' }) }` → `{ error: '…' }`.
- Then `npm install zod@^4.6.7 @hookform/resolvers@^5`, commit the new lock file, run the release-check and test the three forms.

**React Router 6 → 7.18.6.** The app uses only the declarative API (`BrowserRouter`, `Routes`, `Route`, `Navigate`, `Outlet`,
`Link`, `NavLink`, `useNavigate`, `useParams`, `useLocation`, `useSearchParams`) – no data routers, loaders, `json`/`defer`.
Steps: change imports from `react-router-dom` to `react-router` (or keep `react-router-dom` 7, which re-exports), React 18 and
Node 22 are supported; check the v7 behaviour changes (state updates wrapped in `startTransition`, relative paths in splat
routes – the app has no splat routes except the catch-all). Test: sign-in redirect, `ProtectedRoute` for every role, deep links
(`/cohorts/:id`, `/sessions/:id`, `/assignments/:id`, `/courses/:id`), the catch-all page, Founder/Co-Founder/Super Administrator menus.

## 5. Development dependencies (full audit): critical 2, high 2, moderate 5 – **not fixed, documented**

All are test or build tooling that never reaches the website: Vitest 2.1.9 (critical: Vitest UI server file read; @vitest/mocker
path traversal/code injection), tinypool 1.1.1 (critical: prototype-pollution → code execution in the test worker pool; fixed in
tinypool 2.1.1/2.1.2), vite-node, Vite 5.4.21 (high: dev-server path traversal / `server.fs.deny` bypasses / launch-editor on
Windows), esbuild 0.21.5 (moderate: dev server answers other websites). Risk: developer computers and CI runners, mainly while
`vite dev` or Vitest UI run. Mitigations now: do not run the dev server or Vitest UI on shared networks; CI runs no dev server.
Fix: Vite 5 → current (the audit names 8.3.8) with a compatible `@vitejs/plugin-react`, and Vitest 2 → current (5.1.1); a separate
change with a full test run (`npm test`, build, CSP check), because Vite 8 changes the bundler.

## 6. Files changed on the branch
See the "Changed files" list in the delivery message (`git diff --stat main`). In short: `eslint.config.js`,
`src/features/import/rules.ts`, `src/features/intelligence/rules.ts`, `src/features/performance/PerformancePage.tsx`,
`src/features/curriculum/ApprovalCenterPage.tsx`, `scripts/release-check.mjs`, new `scripts/secret-scan-allowlist.json`,
new `package-lock.json` (as generated by the workflow, dependencies unchanged), this document, `README.md` pointer.

## 7. What to run on the branch
The release-check workflow runs automatically on push. Expected: Node, lock file, `npm ci`, TypeScript, **ESLint PASS**, build
PASS; dist checks **FAIL with the exact match and source** (review it, §2); npm audit **FAIL** (§3–5, pending your decision on
the upgrades).

## 8. Cloudflare deployment: "The version of Vite used in the project (5.4.21) cannot be automatically configured" (second commit)

**Cause.** The Cloudflare project runs `npx wrangler deploy` after the (successful) build. The repository had no Wrangler
configuration, so Wrangler started its automatic framework configuration, which for Vite installs the Cloudflare Vite plugin –
that plugin needs Vite 6 or newer – and rewrites the project files during the build.

**Fix (no dependency change).** New `wrangler.jsonc`: the site is deployed as static assets from `./dist` with
`not_found_handling: "single-page-application"`, no Worker script and no variables. Cloudflare applies `dist/_headers` (security
headers and Content-Security-Policy) to every response. Vite, React, TypeScript, Tailwind and `package-lock.json` are unchanged, so
everything that already built and passed keeps working. `scripts/release-check.mjs` now checks this file (36/36 self-tests).
`.gitignore` ignores `.wrangler`.

**Why Vite was not upgraded in this change.** The upgrade is not needed for the deployment once the file exists, it would change
the build tool of a build that already passes, and it requires a regenerated `package-lock.json`, which needs the npm registry.
Vite 5 remains a development-tool audit finding (§5); upgrade it separately with a full test run.

**Before the next deployment:** make sure `"name"` in `wrangler.jsonc` equals the Worker's name in the Cloudflare dashboard
(default written: `dira-learn`); Workers Builds stops if they differ.
