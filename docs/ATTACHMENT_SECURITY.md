# Attachment security and virus scanning (migration 29)

Status: built and tested locally (31 database checks; the scanner adapter passes 8 checks against a local fake scanner). Not deployed. **No scanning service has been chosen or paid for.**

## The rule
**Nobody can download a DIRA Connect attachment until a virus scanner has marked it clean.** That includes the person who uploaded it, facilitators, moderators, oversight readers and safeguarding officers. Until then the conversation shows the file's name and size with "Waiting for a virus check before it can be opened".
- **Infected:** hidden from everyone; the sender is told the file was blocked.
- **Three failed checks:** the file is marked "could not be checked" and stays unavailable.
- **Every result is logged** (`connect_attachment_scans`), and executives and moderators can read the log.
- **Unchanged from Phase 4:** allowed types (PDF, Word, Excel, PowerPoint, JPG, PNG), 10 MB, 3 files per message, the private bucket, and access that follows the conversation.
- **Without a scanner, attachments can be shared but not opened.** The Connect moderation page shows how many files are waiting.

## How scanning works
The `scan-attachments` Edge Function runs on a schedule (every 2 to 5 minutes is enough):
1. It claims up to 10 waiting files, so none is scanned twice; a claim abandoned for 15 minutes is retried.
2. It reads each file from storage with the server key.
3. It sends each file to the configured scanner and records the result.

If no scanner is configured, it does nothing.

## Options and costs (researched 19 November 2026; confirm with the provider before buying)
| Option | Price found | Things to weigh |
|---|---|---|
| **Scanii** (hosted API) | Basic $49/month for 1,000 files, Plus $99 for 5,000, Premium $199 for 10,000 (official pricing page). The provider says not-for-profits may qualify for Basic at $9.99/month by emailing support. | Files stay in a region you choose (US, Ireland, UK, Australia, Singapore, Canada), which helps with data protection for safeguarding evidence. Up to 2 GB per file. |
| **Cloudmersive** (hosted API) | Free tier reported as 600 or 800 calls per month (sources differ); paid plans reported from $19.99/month. **Not confirmed on the official page.** | The free tier may cover DIRA's volume. Check where files are processed. |
| **Self-hosted ClamAV** (open source) | Software free; you pay for a server | Cannot run inside Supabase. Needs a server with about 3–4 GB of memory, plus updates and monitoring. Files never leave DIRA's server. |
| AttachmentScanner (Heroku add-on) | from about $0.138/hour (roughly $100/month) | Tied to Heroku |
| VirusTotal | Free public API **not allowed** for commercial or organisational products; premium is enterprise-priced | Not suitable |

Rough volume: a cohort of 30 learners sharing a few files a week is well under 500 files a month.

**Decision needed:** which option to use. Data protection is part of the choice (Kenya's Data Protection Act 2019 applies to personal data in learners' files): ask for the provider's data-processing terms.

## Switching scanning on (after you choose, and only with your approval)
- **Self-hosted ClamAV:**
  1. Run a ClamAV REST container that answers HTTP 200 for clean and 406 for infected. Check the image you choose.
  2. Then set the secrets: `supabase secrets set SCANNER_PROVIDER=clamav-rest SCANNER_URL=https://your-scanner/scan SCANNER_TOKEN=...`
  3. Deploy the function: `supabase functions deploy scan-attachments`.
  4. Schedule it with header `x-cron-secret: <CRON_SECRET>`.
- **Hosted provider:** a small adapter for its API is added to `supabase/functions/_shared/scanner.ts` (half a day's work, tested the same way). It is not written yet, so that its details are taken from the provider's current documentation rather than guessed.
- **Test with the EICAR test file** (a harmless file every scanner flags) before real use.

## Rollback
`supabase/rollback/20260101000029_attachment_scanning_down.sql` (verified exact). **Warning:** after rolling back, unscanned files become downloadable again.

## All other uploaded files (migration 35, 20 Nov 2026)
The same scan-before-download rule now covers application documents, submissions, project evidence, course materials and
learning resources: a file opens only after a clean scan of exactly that version; the uploader may open their own file while it
waits (never when infected). The same `scan-attachments` function and scanner settings are used. Trainers open learner files only
for their own cohorts; application documents only programme staff. See `docs/deployment/SECURITY_CORRECTIONS_REPORT_2026-11-20.md`.
