# DIRA LEARN – self-service password recovery

Added 19 Nov 2026. **Every DIRA LEARN account can now reset its password from the sign-in page with an emailed code; no administrator is needed.** The flow is the same for every role: learners, facilitators, mentors, M&E officers, coordinators, directors, super administrators, founders and co-founders. Nothing has been deployed, and the live Supabase project has not been touched.

## 1. How it works

| Step | Screen | What happens |
|---|---|---|
| 1 | Sign-in page → **Forgot password?** | Opens `/forgot-password` |
| 2 | **Forgot your password?** | The person enters their email. DIRA LEARN calls Supabase Auth `resetPasswordForEmail`. |
| 3 | **Check your email** | The same message is always shown: "If an account exists for this email address, we have sent a password reset code…". Supabase emails a 6-digit code only if the account exists. |
| 4 | **Check your email** (code) | The person enters the code. DIRA LEARN calls `verifyOtp({ email, token, type: 'recovery' })`. This is the recovery-specific check, not email sign-in. **Send a new code** is available after a 60-second countdown. |
| 5 | **Choose a new password** | Shown only after a successful verification. The person enters the new password and confirms it (Show/Hide control). The existing DIRA LEARN rules apply: at least 10 characters, letters and digits, not the email address. |
| 6 | Back to **sign in** | `updateUser({ password })`, then sign-out on every device. The sign-in page shows "Your password has been changed. Sign in with your new password." |

**Expired, wrong or used codes** all show: "That code is not correct or has expired. Check the latest email from DIRA LEARN, or ask for a new code." **Back to sign in** is on every step.

## 2. Security controls

| Requirement | How it is met |
|---|---|
| Supabase Auth's own recovery and OTP | `resetPasswordForEmail` → `verifyOtp` type `recovery` → `updateUser`. DIRA LEARN stores no codes or tokens of its own. |
| No password change before verification | The new-password screen appears only after `verifyOtp` succeeds, and Supabase refuses `updateUser` without that session (tested). |
| Code expiry | 15 minutes (`otp_expiry = 900`). Codes are single-use, and a newer code replaces the older one (tested). |
| Guessing and request limits | Supabase allows 30 code checks per 5 minutes per IP (`token_verifications`). The screen also locks after 5 wrong codes and asks for a new code. Requests are limited to one per minute per address (`max_frequency = "1m"`) and by the hourly email limit (`email_sent`). |
| Resend with cooldown | "Send a new code in 59s…" countdown, matching the server's once-a-minute rule |
| No account disclosure | The same message for registered and unknown addresses. A "too soon" (429) answer, which only a registered address can trigger, is shown with the same message too. |
| Codes cannot be reused | Supabase clears the code when it is used. Verifying it again fails (tested). |
| Role, status, profile and permissions unchanged | A reset only touches Supabase's own `auth.users` row. No DIRA LEARN trigger runs on user updates, and no database function touches passwords. Profiles are identical before and after, for all nine roles (tested). |
| No passwords by email | The template contains only a code. Tests check that the email contains no password and no reset link. |
| No logging of codes, passwords or tokens | The screens never write to the console (checked in Chrome and by a static check). The local test prints no codes (checked). Supabase-side logging is Supabase's. |
| One user cannot reset another's password | The code goes only to the account's own inbox, and one account's code does not work for another (tested). The API roles have no access to `auth.users` (tested). |
| Recovery session handled safely | While a verified recovery is unfinished, every other page sends the person back to the new-password step. Cancelling signs the session out. Saving signs out every device. |

## 3. Database and authentication changes

- **Database: none.** No migration was added; migrations 30, 31 and 32 and the 26 V13.2 lesson plans are unchanged. One new pgTAP test (`supabase/tests/password_recovery.test.sql`, 12 checks) proves a reset changes no profile or permission.
- **Local authentication settings** (`supabase/config.toml`):
  - `[inbucket]` renamed to `[local_smtp]` (the obsolete section that Supabase CLI v3 refuses)
  - `minimum_password_length = 10` and `password_requirements = "letters_digits"` (the existing DIRA LEARN rules, now also enforced by Supabase)
  - `[auth.rate_limit] email_sent = 30` and `token_verifications = 30`
  - `[auth.email] otp_length = 6`, `otp_expiry = 900`, `max_frequency = "1m"`, `secure_password_change = false` (unchanged default)
  - `[auth.email.template.recovery]` subject "Your DIRA LEARN password reset code", content `supabase/templates/recovery.html`
- **Email template** (`supabase/templates/recovery.html`):
  - DIRA LEARN branding (purple, orange, white), the code `{{ .Token }}` in large type, how and where to enter it, 15 minutes and single use, a warning not to share the code, and "ignore if you did not ask".
  - **No link** on purpose: email security scanners that open links can use up a one-time link before the person sees it.

## 4. Production (live) configuration – needs your approval, not done

The hosted project cannot be configured from `config.toml`. In the Supabase dashboard of the live project:

1. **Custom SMTP is required.**
   - Supabase's default sender only delivers to members of the project's team, is limited to about 2 emails an hour, and is not meant for production.
   - New free-plan projects on the default sender cannot edit email templates since 3 June 2026, so the code template needs custom SMTP.
   - The project already plans Resend (`docs/EMAIL_SETUP.md`): Authentication → Emails → SMTP settings, host `smtp.resend.com`, user `resend`, password = a Resend API key, sender on DIRA's verified domain.
   - Resend's free plan allows 100 emails a day (3,000 a month), with paid plans from about $20 a month. **Do not buy or enable a paid plan without approval.**
2. **Template:** Authentication → Emails → Templates → Reset password. Subject "Your DIRA LEARN password reset code"; body = the contents of `supabase/templates/recovery.html`. Keep `{{ .Token }}` and do not add `{{ .ConfirmationURL }}`.
3. **Auth settings:**
   - Email OTP length 6 and expiration 900 seconds (15 minutes);
   - minimum password length 10, with letters and digits required;
   - Site URL = the live DIRA LEARN address;
   - Rate limits: emails per hour suited to the SMTP plan (Supabase raises the default to 30 with custom SMTP), and token verifications 30 per 5 minutes.
4. **Check:** after any SMTP change, send a test reset to a staff address and confirm the email shows a code and no link.

## 5. Tests

| Test | Where it runs | Result |
|---|---|---|
| Unit tests `recoveryRules.test.ts` (7): code format, password rules and mismatch, cooldown, error mapping, generic message, recovery flag | here | 7/7 |
| Database test `password_recovery.test.sql` (12): profiles unchanged for 9 roles after Supabase-style recovery updates; no triggers or functions on passwords; learners and staff cannot read or set passwords; anonymous visitors cannot look up emails | here (PostgreSQL 16) | 12/12 |
| Browser test in Chrome of the real screens against a **simulated** Supabase Auth (`tools/recovery/browser`) | here | 12/12 |
| Dry run of the real-Supabase test against a mock server and a scratch copy of the test database (`tools/recovery/dryrun`) | here | 27/27; no codes printed |
| **Real local Supabase**: `tools/recovery/recovery_check.mjs` (27 checks, via `TEST-PASSWORD-RECOVERY.bat`) | your computer | not run here (no Docker daemon) |
| **Real local Supabase in a browser**: `e2e/password-recovery.spec.ts` (Playwright) | your computer | not run here |

The browser test here covers:
- the link from sign-in;
- unknown vs registered address (same message; only the registered one is emailed);
- wrong, correct, used and expired codes;
- resend cooldown and a replaced code;
- 5-wrong-codes lock and the server rate-limit message;
- mismatch and weak passwords, and the Show control;
- success, back to sign in, the old password refused and the new one accepted;
- the recovery session blocked from other pages, cancel signing out, and no password step without verification;
- a Founder using the same screens with the role unchanged;
- nothing logged to the browser console.

Mutation checks:
- Showing a different message for "too soon" fails the browser test.
- Removing the recovery guard fails the browser test.
- A mock that accepts reused codes fails the dry run.

**Not verified here:**
- the real Supabase Auth and Mailpit on CLI v3 (the exact error codes, and whether the expiry simulation by changing `recovery_sent_at` works on your version);
- Tailwind styling and the mobile layout in a real browser;
- the Windows `.bat` files.

Run `TEST-PASSWORD-RECOVERY.bat` and send the result.

## 6. Local testing on Windows

1. `START-DIRA-LEARN.bat`. If Supabase was already running with the old settings, it now offers a restart (data kept), because Supabase reads `config.toml` and the email template only when it starts.
2. `CREATE-DIRA-TEST-ACCOUNTS.bat` (once).
3. On the sign-in page click **Forgot password?**, enter `learner1@dira-test.local`, and open the local test inbox at http://localhost:54324 to read the code.
4. `TEST-PASSWORD-RECOVERY.bat` runs the automated checks. It changes some test passwords for a few minutes and sets them back to `DiraTest!2026`.

## 7. Supabase CLI v3 compatibility (launcher)

Supabase CLI v3 was released on 2 November 2026, and npm installs it by default.

**Compatibility correction:**
- **Pinned version:** the project pins `"supabase": "^3.0.0"` in `package.json` devDependencies. `npm install` puts CLI v3 into the project, so `npx supabase` always uses that version, not whatever happens to be installed.
- **Version check:** the launcher refuses an older tool and says how to fix it.
- **Mail section:** `[inbucket]` is now `[local_smtp]`. CLI v3 refuses the old name, and the keys inside are unchanged (`enabled`, `port = 54324`).
- **Email sign-in:** `[auth.email] enable_signup` is now `enabled`, the v3 name. The old one is deprecated and removed in v4. `[auth] enable_signup` is not deprecated and is kept.
- **Postgres version:** `[db] major_version = 15` is kept on purpose. It must match the live database, and changing it would make an existing local database volume unreadable. Check the live version (read-only) with `SHOW server_version;` before ever changing it.
- **Other keys checked against the v3 migration guide** (removed keys: `[inbucket]`, `[auth.external.linkedin]`, `[auth.external.slack]`, `[experimental] orioledb_version`, `[experimental.inspect.rules]`; deprecated: `[auth.email]` and `[auth.sms]` `enable_signup`): no other entry in this file is affected.
- **`migration up`:** run without `--local`, which v3 deprecates because local is the default.
- **Mail address:** the launchers read `MAILPIT_URL`, with `INBUCKET_URL` as a fallback.
- **Database container:** found by name, with a fallback in case v3 adds a suffix. Another project's database is never picked.
- **After start**, the launcher checks that each local service answers:
  - the database (`select 1`);
  - Supabase Auth (`/auth/v1/health` = 200);
  - Studio (http://localhost:54323);
  - the Mailpit test inbox (`/api/v1/info` = 200).
  
  Database or Auth failures stop with a message. Studio or inbox problems are warnings.
- **Settings changes:** when `config.toml` or the email template changed, the launcher offers a restart that keeps the data.
- **`CHECK-DIRA-LEARN.bat`:** reports the same service checks, the CLI version, an old `[inbucket]` section, a missing template, and `SUPABASE_*` lines in `.env.local`, which v3 reads.

**Not verified:** none of this has been run with Supabase CLI v3 on Windows. The build environment has no Windows, and Docker images and npm packages cannot be downloaded there. Follow `README-LOCAL-TESTING.txt` section 10 and send the result.
