import { describeFunctionError, readFunctionErrorMessage } from './functionError';

// The three error types of supabase.functions.invoke (FunctionsHttpError, FunctionsRelayError, FunctionsFetchError), built the
// way the Supabase client builds them: name + message + context.
const httpError = (status: number, body: string) => Object.assign(new Error('Edge Function returned a non-2xx status code'), { name: 'FunctionsHttpError', context: new Response(body, { status }) });
const fetchError = () => Object.assign(new Error('Failed to send a request to the Edge Function'), { name: 'FunctionsFetchError', context: new TypeError('Failed to fetch') });

describe('describeFunctionError', () => {
  it('a network/CORS/not-deployed failure (context is an Error, not a Response) no longer throws "json is not a function"', async () => {
    const info = await describeFunctionError(fetchError());
    expect(info.kind).toBe('unreachable'); expect(info.status).toBeNull(); expect(info.message).toMatch(/No answer was received/);
  });
  it('reads the function\'s own error text from an HTTP error', async () => {
    expect(await describeFunctionError(httpError(403, '{"error":"Forbidden"}'))).toEqual({ kind: 'http', status: 403, message: 'Forbidden' });
  });
  it('an HTTP error without a JSON body gives a plain message with the status', async () => {
    expect((await describeFunctionError(httpError(502, '<html>Bad gateway</html>'))).message).toBe('The server answered with an error (HTTP 502).');
  });
  it('a relay error has its own message', async () => {
    const e = Object.assign(new Error('Relay Error invoking the Edge Function'), { name: 'FunctionsRelayError', context: new Response('', { status: 500 }) });
    expect((await describeFunctionError(e)).kind).toBe('relay');
  });
  it('the body can still be read afterwards (a clone is read)', async () => {
    const e = httpError(400, '{"error":"No learners supplied"}'); await readFunctionErrorMessage(e);
    expect(await (e.context as Response).json()).toEqual({ error: 'No learners supplied' });
  });
  it('anything else falls back to its message or a fixed text', async () => {
    expect(await readFunctionErrorMessage(new Error('boom'))).toBe('boom');
    expect(await readFunctionErrorMessage(null)).toBe('Something went wrong. Please try again.');
    expect(await readFunctionErrorMessage({ context: 'text' })).toBe('Something went wrong. Please try again.');
  });
});
