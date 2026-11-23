# Google Calendar sync – setup (22 Nov 2026)

DIRA LEARN copies its scheduled sessions **one way** to **one** Google Calendar that belongs to the organisation.
DIRA LEARN stays the source of truth. Nothing is read back from Google, and no personal calendar is touched.

> **Status:** prepared and tested locally only. Nothing has been set up in Google, and nothing is deployed.
> Every step below is for you (the owner) to carry out after approval.

## How it works

1. Any change to a session schedule (new, changed, cancelled, deleted) is written to a queue table, `gcal_events`. A database trigger does this, so it happens in the same transaction as the change.
   - If anything goes wrong while queuing, the change to the DIRA LEARN calendar still goes through. The trigger only logs a warning.
2. The Edge Function `google-calendar-sync` works through the queue.
   - It runs every few minutes from a scheduler, or when staff press **Sync now** on the Calendar page.
   - It signs in to Google as a **service account** and creates, updates or cancels the event.
3. **No duplicates.**
   - Every session has a fixed Google event id: `dira` + the session id without dashes.
   - A "create" that Google answers with *already exists* (409) becomes an update.
   - Deleting an event that is already gone (404/410) counts as done.
4. **Failures are safe.**
   - A failed change stays in the queue and is retried with increasing waits.
   - After 8 attempts it is marked **failed**, with Google's error text.
   - The Calendar page shows staff and trainers the counts (waiting / in Google / failed) and the last errors. It offers **Retry failed** and **Send all upcoming sessions again**.
   - Learners never see this panel.
5. **If Google is not set up or unavailable,** the DIRA LEARN calendar works exactly as before. Changes simply wait in the queue.

## What you need

- A Google account that administers the organisation's calendar. A Google Workspace account is best; a normal Google account also works.
- A Google Cloud project. Creating one, the Calendar API and a service account are **free**; the Calendar API has usage quotas but no charge. No billing account is needed for this.

## Step by step

1. **Create (or choose) the calendar.**
   - In Google Calendar, create a calendar such as "DIRA LEARN sessions" under the organisation's account.
   - Open *Settings and sharing → Integrate calendar* and copy the **Calendar ID**. It looks like `abc123…@group.calendar.google.com`.
   - Do **not** use a person's main calendar unless you explicitly want that.
2. **Create a Google Cloud project.** Go to <https://console.cloud.google.com/>, then *New project* (for example "dira-learn-calendar").
3. **Enable the Google Calendar API.** Go to *APIs & Services → Library → Google Calendar API → Enable*.
4. **Create a service account.**
   - Go to *IAM & Admin → Service accounts → Create service account* (for example `dira-learn-sync`). It needs no project roles.
   - Open it, go to *Keys → Add key → Create new key → JSON*, and download the file.
   - Keep the file private. Do not email it, commit it or paste it into chat.
5. **Share the calendar with the service account.**
   - In Google Calendar, open *Settings and sharing → Share with specific people → Add people*.
   - Add the service account's address (`…@….iam.gserviceaccount.com`) with **"Make changes to events"**.
   - This is the only calendar it can reach.
6. **Store the secrets in Supabase.** Use *Project Settings → Edge Functions → Secrets*, or `supabase secrets set` on your own computer.
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL`: the `client_email` from the JSON file.
   - `GOOGLE_SERVICE_ACCOUNT_KEY`: the `private_key` from the JSON file. Copy the whole value, including its first and last lines (the "BEGIN" and "END" lines). Literal `\n` sequences are accepted.
   - `GOOGLE_CALENDAR_ID`: the Calendar ID from step 1.
   - `GOOGLE_CALENDAR_TIMEZONE` (optional): defaults to `Africa/Nairobi`.
   - `CRON_SECRET`: already used by `send-emails`. If it is not set yet, use a long random string.

   These secrets live only in Supabase. They are never in the website, the ZIP or GitHub.
7. **Deploy the function** (after approval), together with the others, using the manual GitHub workflow *Deploy Supabase Edge Functions*, or:
   `supabase functions deploy google-calendar-sync --no-verify-jwt`
   - The function checks the scheduler's secret or the staff member's sign-in itself, as `supabase/config.toml` records.
   - If you deploy from the Dashboard, switch **Verify JWT off** for this function only.
8. **Schedule it** every 5 minutes.
   - Use *Supabase Dashboard → Integrations → Cron → Create job → HTTP request*:
     - Method `POST`
     - URL `https://<project-ref>.supabase.co/functions/v1/google-calendar-sync`
     - Headers:
       - `Content-Type: application/json`
       - `x-cron-secret: <CRON_SECRET>`
     - Body `{}`
   - Supabase Cron is included in every plan. Any other scheduler that can send this request also works.
9. **First run.**
   - Sign in as programme staff and open **Calendar**. The *Google Calendar sync* panel should no longer say "Not set up".
   - Press **Send all upcoming sessions again** to queue every future session once, then **Sync now**.
   - Check the Google calendar. Run *Sync now* again: no duplicates should appear.

## Checking and troubleshooting

| What you see | Meaning / fix |
|---|---|
| "Not set up" | One of the three `GOOGLE_*` secrets is missing. |
| Error `invalid_grant` or `Google sign-in failed (HTTP 400/401)` | Wrong key or e-mail, or the key was deleted in Google Cloud. Create a new key and update the secret. |
| `HTTP 403` / `404` from Google Calendar | The calendar is not shared with the service account (step 5), or the Calendar ID is wrong. |
| Items stay "waiting" | The scheduler is not running (step 8). Use *Sync now* meanwhile. |
| "failed" items | Fix the cause, then press **Retry failed**. |

## Turning it off

Remove the scheduler job and/or the `GOOGLE_*` secrets. The queue keeps recording changes but nothing is sent.
Events already in Google stay there. Delete the calendar in Google if you no longer want them.
To remove the database part entirely, see the rollback in `supabase/pending/20261122000002_chat_notifications_calendar_rollback.sql`.
