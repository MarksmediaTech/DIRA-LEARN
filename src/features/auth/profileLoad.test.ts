import { problemKind, PROFILE_TIMEOUT_MS, classifyProfileResult, errorCode, profileProblemText, withTimeout } from './profileLoad';

const row = { id: 'u1', role: 'applicant', status: 'active', first_name: null, last_name: null, organization_id: null };

describe('profile loading after sign-in or email verification', () => {
  it('a profile row is ready', () => {
    expect(classifyProfileResult('u1', row, null)).toEqual({ state: 'ready', profile: row });
  });
  it('no row is "missing", not an endless wait', () => {
    expect(classifyProfileResult('u1', null, null)).toEqual({ state: 'missing' });
  });
  it('database errors keep their code (missing column, refused, no rows with single())', () => {
    expect(classifyProfileResult('u1', null, { code: '42703', message: 'column profiles.organization_id does not exist' })).toEqual({ state: 'error', code: '42703' });
    expect(classifyProfileResult('u1', null, { code: '42501', message: 'permission denied for table profiles' })).toEqual({ state: 'error', code: '42501' });
    expect(classifyProfileResult('u1', null, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' })).toEqual({ state: 'error', code: 'PGRST116' });
  });
  it('an inactive account (migration 34 refusal) becomes the "not active" profile, never privileged', () => {
    const r = classifyProfileResult('u1', null, { code: '42501', message: 'DIRA_ACCOUNT_INACTIVE' });
    expect(r.state).toBe('ready'); if (r.state === 'ready') { expect(r.profile.status).toBe('deactivated'); expect(r.profile.role).toBe('applicant'); }
  });
  it('a row for another user or without role/status is rejected', () => {
    expect(classifyProfileResult('u1', { ...row, id: 'u2' }, null)).toEqual({ state: 'error', code: 'PROFILE_INVALID' });
    expect(classifyProfileResult('u1', { id: 'u1' }, null)).toEqual({ state: 'error', code: 'PROFILE_INVALID' });
  });
  it('error codes are short and contain no message text or tokens', () => {
    expect(errorCode(new TypeError('Failed to fetch'))).toBe('NETWORK');
    expect(errorCode({ status: 503 })).toBe('HTTP_503');
    expect(errorCode({ code: 'eyJhbGciOi.secret.token" <script>' })).toMatch(/^[A-Za-z0-9_-]{1,24}$/);
    expect(errorCode(undefined)).toBe('UNKNOWN');
  });
  it('a request that never answers ends with TIMEOUT', async () => {
    expect(PROFILE_TIMEOUT_MS).toBe(15_000);
    const failure = await withTimeout(new Promise(() => {}), 20).then(() => null, (e: unknown) => e);
    expect((failure as { code?: string } | null)?.code).toBe('TIMEOUT');
  });
  it('a quick answer is passed through', async () => {
    const value = await withTimeout(Promise.resolve(7), 50);
    expect(value).toBe(7);
  });
  it('problem texts for missing and error, none for other states', () => {
    expect(profileProblemText({ state: 'missing' })?.body).toMatch(/PROFILE_MISSING/);
    expect(profileProblemText({ state: 'error', code: 'NETWORK' })?.body).toMatch(/NETWORK/);
    expect(profileProblemText({ state: 'loading' })).toBeNull();
  });
  it('groups error codes by what the person can do (21 Nov 2026)', () => {
    const k = (code: string) => problemKind({ state: 'error', code });
    expect(k('42501')).toBe('permission'); expect(k('HTTP_403')).toBe('permission');
    expect(k('PGRST301')).toBe('session'); expect(k('PGRST303')).toBe('session'); expect(k('HTTP_401')).toBe('session');
    expect(k('PGRST205')).toBe('not-initialised'); expect(k('42P01')).toBe('not-initialised');
    expect(k('NETWORK')).toBe('connection'); expect(k('TIMEOUT')).toBe('connection'); expect(k('HTTP_503')).toBe('connection');
    expect(k('XX000')).toBe('other');
    expect(problemKind({ state: 'missing' })).toBe('missing');
    expect(problemKind({ state: 'loading' })).toBeNull();
  });
  it('an expired sign-in asks to sign in again; a refusal never blames the connection', () => {
    expect(profileProblemText({ state: 'error', code: 'PGRST301' })?.action).toBe('signin');
    const t = profileProblemText({ state: 'error', code: '42501' });
    expect(t?.action).toBe('retry'); expect(t?.body).toMatch(/42501/); expect(t?.body).not.toMatch(/internet connection/i);
  });
});
