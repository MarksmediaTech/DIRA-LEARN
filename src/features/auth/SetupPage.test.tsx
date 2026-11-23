import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthContext, type AuthState } from './AuthProvider';
import { SetupPage } from './SetupPage';
import { adminPasswordProblem, functionStatus, readFunctionError, setupCodeProblem } from './setupRules';

const invoke = vi.fn(); const signIn = vi.fn();
vi.mock('@/lib/supabase', () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
const fail = (status: number, error: string) => ({ data: null, error: { context: new Response(JSON.stringify({ error }), { status }) } });
function show() {
  const value = { session: null, profile: null, loading: false, signIn, signOut: async () => {}, profileLoad: { state: 'idle' }, reloadProfile: () => {} } as unknown as AuthState;
  return render(<AuthContext.Provider value={value}><MemoryRouter><SetupPage /></MemoryRouter></AuthContext.Provider>);
}
async function fill(code: string, pw: string, confirm = pw) {
  await userEvent.type(await screen.findByLabelText(/^setup code/i), code);
  await userEvent.type(screen.getByLabelText(/^administrator password/i), pw);
  await userEvent.type(screen.getByLabelText(/^confirm password/i), confirm);
  await userEvent.click(screen.getByRole('button', { name: /create the super administrator/i }));
}
beforeEach(() => { invoke.mockReset(); signIn.mockReset(); });

describe('SetupPage (bootstrap-first-admin)', () => {
  it('asks the function whether setup is open, without needing an account first', async () => {
    invoke.mockResolvedValue({ data: { needed: true, enabled: true }, error: null });
    show();
    expect(await screen.findByLabelText(/^setup code/i)).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('bootstrap-first-admin', { body: { action: 'status' } });
  });
  it('says setup is complete when an administrator exists', async () => {
    invoke.mockResolvedValue({ data: { needed: false, enabled: true }, error: null });
    show();
    expect(await screen.findByText(/setup is already complete/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^setup code/i)).not.toBeInTheDocument();
  });
  it('says setup is switched off when the function answers 503', async () => {
    invoke.mockResolvedValue(fail(503, 'off'));
    show();
    expect(await screen.findByText(/setup is switched off/i)).toBeInTheDocument();
  });
  it('sends the code and password, then signs in with the address the function returns', async () => {
    invoke.mockResolvedValueOnce({ data: { needed: true, enabled: true }, error: null }).mockResolvedValueOnce({ data: { ok: true, email: 'marksmedia.studios@gmail.com' }, error: null });
    signIn.mockResolvedValue(null);
    show();
    await fill(' my-secret-code ', 'Orange-Purple-2026');
    await waitFor(() => expect(invoke).toHaveBeenLastCalledWith('bootstrap-first-admin', { body: { setupCode: 'my-secret-code', password: 'Orange-Purple-2026' } }));
    expect(signIn).toHaveBeenCalledWith('marksmedia.studios@gmail.com', 'Orange-Purple-2026');
    expect(await screen.findByText(/setup is complete/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /continue to dira learn/i })).toHaveAttribute('href', '/');
  });
  it('shows the server message when the code is wrong', async () => {
    invoke.mockResolvedValueOnce({ data: { needed: true, enabled: true }, error: null }).mockResolvedValueOnce(fail(403, 'That setup code is not right.'));
    show();
    await fill('nope', 'Orange-Purple-2026');
    expect(await screen.findByRole('alert')).toHaveTextContent('That setup code is not right.');
  });
  it('rejects a weak password before calling the function', async () => {
    invoke.mockResolvedValue({ data: { needed: true, enabled: true }, error: null });
    show();
    await fill('code', 'short1');
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 12/i);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe('setup helpers', () => {
  it('validates the code', () => { expect(setupCodeProblem('  ')).not.toBeNull(); expect(setupCodeProblem('abc')).toBeNull(); });
  it('validates the administrator password', () => {
    expect(adminPasswordProblem('Orange-Purple-2026', 'Orange-Purple-2026')).toBeNull();
    expect(adminPasswordProblem('abcdefghijklm', 'abcdefghijklm')).toMatch(/letters and numbers/);
    expect(adminPasswordProblem('Orange-Purple-2026', 'x')).toMatch(/do not match/);
  });
  it('reads the HTTP status of a failed call', () => { expect(functionStatus({ context: new Response('', { status: 409 }) })).toBe(409); expect(functionStatus(new Error('x'))).toBeNull(); });
  it('falls back to the error message when there is no response body', async () => { expect(await readFunctionError(new Error('boom'))).toBe('boom'); });
});
