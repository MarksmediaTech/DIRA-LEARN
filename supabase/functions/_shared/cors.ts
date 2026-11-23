// CORS for the Edge Functions that the DIRA LEARN website calls from the browser (post-audit fix H2, 20 Nov 2026).
// Allowed origins: the origin of APP_URL plus the comma-separated list in the ALLOWED_ORIGINS secret (for example the
// Cloudflare preview address). No wildcard. CORS is not access control: every function still checks who is calling.
// Requests without an Origin header (scheduler, curl, server-to-server) are passed through unchanged.
export const ALLOWED_METHODS = 'POST, OPTIONS';
// The headers supabase-js sends with functions.invoke().
export const ALLOWED_HEADERS = 'authorization, x-client-info, apikey, content-type, x-supabase-api-version, x-region';

type Env = (name: string) => string | undefined;
const denoEnv: Env = (name) => (globalThis as { Deno?: { env: { get(n: string): string | undefined } } }).Deno?.env.get(name);

function toOrigin(value: string): string | null {
  try {
    const u = new URL(value.trim());
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))) return null;
    return u.origin;
  } catch { return null; }
}

export function allowedOrigins(env: Env = denoEnv): Set<string> {
  const list = [env('APP_URL') ?? '', ...(env('ALLOWED_ORIGINS') ?? '').split(',')];
  return new Set(list.map(toOrigin).filter((o): o is string => o !== null));
}

export function corsHeaders(origin: string): Record<string, string> {
  return { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': ALLOWED_METHODS,
           'Access-Control-Allow-Headers': ALLOWED_HEADERS, 'Access-Control-Max-Age': '600', Vary: 'Origin' };
}

export function withCors(handler: (req: Request) => Response | Promise<Response>, env: Env = denoEnv) {
  return async (req: Request): Promise<Response> => {
    const origin = req.headers.get('Origin');
    const allowed = origin !== null && allowedOrigins(env).has(origin);
    if (req.method === 'OPTIONS') {
      return allowed ? new Response(null, { status: 204, headers: corsHeaders(origin) }) : new Response(null, { status: 403, headers: { Vary: 'Origin' } });
    }
    if (origin !== null && !allowed) {
      return new Response(JSON.stringify({ error: 'This website address is not allowed to call DIRA LEARN functions' }),
        { status: 403, headers: { 'Content-Type': 'application/json', Vary: 'Origin' } });
    }
    const res = await handler(req);
    const headers = new Headers(res.headers);
    if (allowed) for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
    else headers.append('Vary', 'Origin');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  };
}
