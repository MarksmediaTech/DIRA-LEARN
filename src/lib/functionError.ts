/**
 * Reads the error of a failed `supabase.functions.invoke(...)` safely (22 Nov 2026).
 *
 * Why this exists: the Supabase client returns three kinds of function errors, and only two of them carry an HTTP response.
 *  - FunctionsHttpError  - the function answered with a non-2xx status: `context` is the fetch Response (has .json()).
 *  - FunctionsRelayError - Supabase's relay could not reach the function: `context` is the Response.
 *  - FunctionsFetchError - the request never got a readable answer (function not deployed - browsers report a 404 without
 *    CORS headers as a network error -, the website address not allowed by the function's CORS rule, offline, timeout):
 *    `context` is the underlying error object (e.g. TypeError "Failed to fetch"), NOT a Response.
 * The import and email pages called `context.json()` unconditionally, so a FunctionsFetchError crashed the handler with
 * "j.json is not a function" (`j` = the minified name of `context`) instead of showing what went wrong.
 * This helper never calls a method that may not exist, reads the body once from a clone, and returns only the function's own
 * `error` text (which our functions keep free of secrets) or a fixed, plain explanation.
 */
export type FunctionErrorKind = 'http' | 'relay' | 'unreachable' | 'unknown';
export interface FunctionErrorInfo { kind: FunctionErrorKind; status: number | null; message: string }

const isResponseLike = (v: unknown): v is Response =>
  typeof v === 'object' && v !== null && typeof (v as Response).status === 'number' && typeof (v as Response).clone === 'function';

export async function describeFunctionError(error: unknown, fallback = 'Something went wrong. Please try again.'): Promise<FunctionErrorInfo> {
  const e = (error ?? {}) as { name?: unknown; message?: unknown; context?: unknown };
  const name = typeof e.name === 'string' ? e.name : '';
  const ctx = e.context;
  if (isResponseLike(ctx)) {
    let text: string | null = null;
    try {
      const body: unknown = await ctx.clone().json();
      const err = (body as { error?: unknown } | null)?.error;
      if (typeof err === 'string' && err.trim()) text = err.trim().slice(0, 500);
    } catch { /* not JSON: keep the plain explanation below */ }
    const relay = name === 'FunctionsRelayError';
    return {
      kind: relay ? 'relay' : 'http', status: ctx.status,
      message: text ?? (relay ? 'The DIRA LEARN server could not reach this function right now. Please try again in a moment.'
        : `The server answered with an error (HTTP ${ctx.status}).`),
    };
  }
  if (name === 'FunctionsFetchError') {
    return { kind: 'unreachable', status: null,
      message: 'No answer was received from the server function. It may not be deployed yet, this website\'s address may not be allowed for it, or the connection dropped.' };
  }
  return { kind: 'unknown', status: null, message: typeof e.message === 'string' && e.message ? e.message : fallback };
}

/** Only the message (for pages that just show a line of text). */
export const readFunctionErrorMessage = async (error: unknown, fallback?: string): Promise<string> => (await describeFunctionError(error, fallback)).message;
