# Email setup (Resend)

Status: written, **not deployed or tested**. Nothing is sent until you complete these steps. The Email page shows "not connected" until then.

## What sends what
| Email | Sent by |
|---|---|
| Sign-up confirmation, password reset, invitations | **Supabase Auth**. Configure Supabase Auth SMTP (below). Not handled by DIRA Learn code. |
| Bulk and scheduled emails from the Email page | `enqueue_bulk_email` -> outbox -> `send-emails` function |
| Session reminders (next 24 h), assignment reminders (next 48 h) | `queue_reminders()` run by `send-emails` |
| Email copy of in-app notifications (announcements, graded or returned work, certificates, application updates) | Trigger on `notifications` -> outbox |

Automatic emails (the last two rows) stay **off** until a super administrator sets `email_automation` to `{"enabled": true}` under Settings **and approves it**. Review the system template wording first: it is a draft.

## Steps
1. Create a Resend account, add and verify your sending domain (DNS records), and create an API key.
2. Function secrets (never in `.env.local`, never in frontend code):
   `supabase secrets set RESEND_API_KEY=... EMAIL_FROM="DIRA Learn <learn@yourdomain.org>" CRON_SECRET=<long random string> APP_URL=https://your-app-url RESEND_WEBHOOK_SECRET=whsec_...`
3. Deploy: `supabase functions deploy send-emails` and `supabase functions deploy email-webhook --no-verify-jwt` (Resend cannot send a Supabase JWT; the webhook is authenticated by its Svix signature).
4. In Resend add a webhook to `https://<project>.functions.supabase.co/email-webhook` for delivered, bounced, complained and failed events, and copy its signing secret into `RESEND_WEBHOOK_SECRET`.
5. Schedule the sender every 5 to 10 minutes (Supabase Cron, or any scheduler) with a POST to `.../send-emails` and header `x-cron-secret: <CRON_SECRET>`, body `{"action":"run"}`. Without a schedule, use the "Send queued emails now" button.
6. Supabase Auth emails: Dashboard > Authentication > SMTP, use Resend's SMTP (host smtp.resend.com, user `resend`, password = API key). Edit the Auth email templates for the DIRA wording.

## Behaviour to know
- An email moves queued -> sending -> sent (handed to Resend). "Delivered", "bounced" and "marked as spam" appear only when Resend's webhook confirms them.
- A failed send is retried up to 3 times, then marked failed with the provider's message.
- People with `email_opt_out` set are skipped by bulk, reminder and event emails. There is no screen for people to set this yet; an administrator can set it in the database. Every email footer tells people to contact the programme team to stop receiving them.
- Bulk sends are limited to 500 people each. Local testing: Supabase's local test inbox (Mailpit, http://localhost:54324) only catches Auth emails such as password reset codes; the Resend path needs a real key. Password recovery setup: `PASSWORD_RECOVERY.md`.
