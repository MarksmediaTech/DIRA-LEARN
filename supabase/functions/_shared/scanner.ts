// Virus-scanner adapters for the scan-attachments Edge Function (plain web APIs, so they also run under Node for testing).
// 'clamav-rest' contract: POST multipart field "file"; HTTP 200 = clean, 406 = infected, anything else (or no answer) = error.
export type Verdict = { result: 'clean' | 'infected' | 'error'; detail: string };

export async function scanClamavRest(file: Blob, name: string, url: string, token: string | undefined, timeoutMs = 60_000): Promise<Verdict> {
  const form = new FormData();
  form.append('file', file, name);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'POST', body: form, signal: ctrl.signal, headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const text = (await res.text().catch(() => '')).slice(0, 300);
    if (res.status === 200) return { result: 'clean', detail: text };
    if (res.status === 406) return { result: 'infected', detail: text };
    return { result: 'error', detail: `Scanner returned HTTP ${res.status}: ${text}` };
  } catch (e) {
    return { result: 'error', detail: String((e as Error).message).slice(0, 300) };
  } finally { clearTimeout(timer); }
}

