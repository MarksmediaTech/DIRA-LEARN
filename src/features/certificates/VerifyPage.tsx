import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/Button';
import { isCertificateNo } from './rules';

/** Public page: no sign-in. Shows only whether a number is valid, the issue date and the holder's complete name (as saved on the learner's profile). */
export function VerifyPage() {
  const [params, setParams] = useSearchParams();
  const no = (params.get('no') ?? '').trim();
  const [text, setText] = useState(no);
  const valid = isCertificateNo(no);
  const q = useQuery({
    queryKey: ['verify', no],
    enabled: valid,
    retry: false,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('verify_certificate', { cert_no: no });
      if (error) throw error;
      return (data as { valid: boolean; issued_on: string; holder: string }[])[0] ?? null;
    },
  });
  return (
    <main className="mx-auto grid max-w-lg gap-4 p-6">
      <h1 className="text-2xl font-bold text-purple-700">Verify a DIRA LEARN certificate</h1>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); setParams(text.trim() ? { no: text.trim() } : {}); }}>
        <label className="grid flex-1 gap-1 text-sm font-medium">Certificate number
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="DL-2026-000123" className="rounded-control border border-purple-200 px-3 py-2 font-normal" />
        </label>
        <Button type="submit">Check</Button>
      </form>
      {no && !valid && <p role="alert" className="text-danger">That does not look like a certificate number. It has the form DL-2026-000123.</p>}
      {valid && q.isLoading && <p role="status">Checking…</p>}
      {valid && q.isError && <p role="alert" className="text-danger">The check could not be completed. Try again later.</p>}
      {valid && q.isSuccess && !q.data && <p role="alert" className="rounded-card border border-danger p-4">No certificate with this number was found.</p>}
      {valid && q.data && (q.data.valid
        ? <p role="status" className="rounded-card border border-ok p-4">Valid certificate issued to <strong>{q.data.holder}</strong> on {q.data.issued_on}.</p>
        : <p role="alert" className="rounded-card border border-danger p-4">This certificate was issued to {q.data.holder} on {q.data.issued_on} but has been <strong>withdrawn</strong>.</p>)}
      <p className="text-xs text-ink/60">Only the certificate holder's name, the issue date and the status are shown. No other personal details are shown.</p>
    </main>
  );
}
