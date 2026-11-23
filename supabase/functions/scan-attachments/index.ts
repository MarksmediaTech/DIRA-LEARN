// Edge Function: scan uploaded files - DIRA Connect attachments (migration 29) and, since migration 35, every other bucket
// (application documents, submissions, project evidence, course materials, learning resources). NOT deployed, and not yet
// run against a real scanner.
// Called by a scheduler every few minutes with header x-cron-secret = CRON_SECRET (same secret as send-emails).
// Until a scanner is configured it does nothing, so attachments stay "waiting for virus check" and cannot be downloaded.
//
// Secrets (set with `supabase secrets set ...`; never in the frontend):
//   SCANNER_PROVIDER  'clamav-rest' (self-hosted ClamAV behind a REST gateway). Hosted providers are added once DIRA chooses one.
//   SCANNER_URL       full URL of the scan endpoint, e.g. https://scanner.example.org/scan
//   SCANNER_TOKEN     optional bearer token for that endpoint
// 'clamav-rest' contract: POST multipart/form-data with field "file"; HTTP 200 = clean, HTTP 406 = infected, anything else = error.
// (This is the convention of common ClamAV REST images; check the image you deploy before relying on it.)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { scanClamavRest, type Verdict } from '../_shared/scanner.ts';

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } });

function equalSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!equalSecret(req.headers.get('x-cron-secret') ?? '', Deno.env.get('CRON_SECRET') ?? '')) return json({ error: 'Forbidden' }, 403);

  const provider = Deno.env.get('SCANNER_PROVIDER') ?? '';
  const url = Deno.env.get('SCANNER_URL') ?? '';
  if (provider !== 'clamav-rest' || !url) {
    // Safe default: no scanner, no downloads. Nothing is claimed, so files stay pending.
    return json({ configured: false, message: 'No virus scanner is configured. Uploaded files stay unavailable until one is.' });
  }
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: batch, error } = await admin.rpc('connect_claim_scans', { p_limit: 10 });
  if (error) return json({ error: 'Could not claim attachments to scan' }, 500);

  const results: Record<string, number> = { clean: 0, infected: 0, error: 0 };
  for (const f of (batch ?? []) as { attachment_id: string; storage_path: string; file_name: string }[]) {
    let verdict: Verdict;
    const { data: blob, error: dErr } = await admin.storage.from('connect-attachments').download(f.storage_path);
    if (dErr || !blob) verdict = { result: 'error', detail: `Could not read the stored file: ${dErr?.message ?? 'missing'}` };
    else verdict = await scanClamavRest(blob, f.file_name, url, Deno.env.get('SCANNER_TOKEN') ?? undefined);
    const { error: rErr } = await admin.rpc('connect_record_scan', { p_attachment: f.attachment_id, p_result: verdict.result, p_engine: provider, p_detail: verdict.detail });
    if (rErr) return json({ error: 'Could not record a scan result', partial: results }, 500);
    results[verdict.result] = (results[verdict.result] ?? 0) + 1;
  }
  // Migration 35: all other buckets. Each result is recorded for the exact version (updated_at) that was scanned.
  const { data: files, error: fErr } = await admin.rpc('claim_file_scans', { p_limit: 10 });
  if (fErr) return json({ error: 'Could not claim files to scan', partial: results }, 500);
  for (const f of (files ?? []) as { bucket_id: string; object_name: string; object_updated_at: string }[]) {
    let verdict: Verdict;
    const { data: blob, error: dErr } = await admin.storage.from(f.bucket_id).download(f.object_name);
    if (dErr || !blob) verdict = { result: 'error', detail: `Could not read the stored file: ${dErr?.message ?? 'missing'}` };
    else verdict = await scanClamavRest(blob, f.object_name.replace(/^.*\//, ''), url, Deno.env.get('SCANNER_TOKEN') ?? undefined);
    const { error: rErr } = await admin.rpc('record_file_scan', { p_bucket: f.bucket_id, p_name: f.object_name, p_updated_at: f.object_updated_at,
      p_result: verdict.result, p_engine: provider, p_detail: verdict.detail });
    if (rErr) return json({ error: 'Could not record a scan result', partial: results }, 500);
    results[verdict.result] = (results[verdict.result] ?? 0) + 1;
  }
  return json({ configured: true, scanned: (batch ?? []).length + (files ?? []).length, ...results });
});
