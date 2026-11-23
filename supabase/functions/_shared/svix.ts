// Verifies webhook signatures in the Svix format that Resend uses. Pure WebCrypto, so it runs in Deno and Node.
const enc = new TextEncoder();
const b64decode = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64encode = (b: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(b)));

export async function signSvix(secret: string, id: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', b64decode(secret.replace(/^whsec_/, '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return 'v1,' + b64encode(await crypto.subtle.sign('HMAC', key, enc.encode(`${id}.${timestamp}.${body}`)));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** true only when the signature matches AND the timestamp is within `toleranceSeconds` of now. */
export async function verifySvix(secret: string, headers: { id: string | null; timestamp: string | null; signature: string | null }, body: string, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300): Promise<boolean> {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > toleranceSeconds) return false;
  let expected: string;
  try { expected = await signSvix(secret, id, timestamp, body); } catch { return false; }
  return signature.split(' ').some((s) => safeEqual(s.trim(), expected));
}
