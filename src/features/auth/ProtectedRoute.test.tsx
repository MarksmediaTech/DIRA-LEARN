import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext, type AuthState } from './AuthProvider';
import { ProtectedRoute } from './ProtectedRoute';
import type { Profile, RoleCode } from '@/types/database';

const base = { signIn: async () => null, signOut: async () => {}, reloadProfile: () => {} };
const profile = (role: RoleCode, status: Profile['status'] = 'active'): Profile => ({ id: 'u1', role, status, first_name: 'T', last_name: 'U', organization_id: null });

function renderWith(state: Partial<AuthState>, allow?: RoleCode[]) {
  // profileLoad follows the given profile unless a test sets it (ready when a profile is given, otherwise idle).
  const load = state.profileLoad ?? (state.profile ? { state: 'ready' as const, profile: state.profile } : { state: 'idle' as const });
  const value = { session: null, profile: null, loading: false, ...base, ...state, profileLoad: load } as AuthState;
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={['/secret']}>
        <Routes>
          <Route path="/login" element={<p>login page</p>} />
          <Route element={<ProtectedRoute allow={allow} />}><Route path="/secret" element={<p>secret content</p>} /></Route>
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}
const session = {} as AuthState['session'];

describe('ProtectedRoute', () => {
  it('redirects signed-out visitors to login', () => {
    renderWith({});
    expect(screen.getByText('login page')).toBeInTheDocument();
  });
  it('shows a loading state while the session resolves', () => {
    renderWith({ loading: true });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
  it('blocks deactivated accounts', () => {
    renderWith({ session, profile: profile('participant', 'deactivated') });
    expect(screen.getByRole('alert')).toHaveTextContent(/not active/i);
  });
  it('blocks roles that are not allowed', () => {
    renderWith({ session, profile: profile('participant') }, ['trainer']);
    expect(screen.getByRole('alert')).toHaveTextContent(/do not have access/i);
    expect(screen.queryByText('secret content')).not.toBeInTheDocument();
  });
  it('renders content for an allowed role', () => {
    renderWith({ session, profile: profile('trainer') }, ['trainer']);
    expect(screen.getByText('secret content')).toBeInTheDocument();
  });
  it('waits while the profile is loading', () => {
    renderWith({ session, profileLoad: { state: 'loading' } });
    expect(screen.getByRole('status')).toHaveTextContent(/loading your account/i);
  });
  it('never waits for ever: a missing profile shows what happened, Try again and Sign out', () => {
    const reloadProfile = vi.fn(); const signOut = vi.fn(async () => {});
    renderWith({ session, profileLoad: { state: 'missing' }, reloadProfile, signOut });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/PROFILE_MISSING/);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' })); expect(reloadProfile).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' })); expect(signOut).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('secret content')).not.toBeInTheDocument();
  });
  it('a failed profile request shows its code, never the protected page', () => {
    renderWith({ session, profileLoad: { state: 'error', code: 'TIMEOUT' } }, ['applicant']);
    expect(screen.getByRole('alert')).toHaveTextContent(/TIMEOUT/);
    expect(screen.queryByText('secret content')).not.toBeInTheDocument();
  });
  it('the production 403 (code 42501) explains a server set-up problem and never shows the page', () => {
    renderWith({ session, profileLoad: { state: 'error', code: '42501' } }, ['super_admin']);
    expect(screen.getByRole('heading')).toHaveTextContent('DIRA LEARN could not open your account');
    expect(screen.getByRole('alert')).toHaveTextContent(/refused access to your account record.*42501/);
    expect(screen.getByRole('alert')).not.toHaveTextContent(/internet connection/i);
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText('secret content')).not.toBeInTheDocument();
  });
  it('an expired sign-in (PGRST301) offers Sign in again, which signs out to the login page', () => {
    const signOut = vi.fn(async () => {});
    renderWith({ session, profileLoad: { state: 'error', code: 'PGRST301' }, signOut });
    expect(screen.getByRole('heading')).toHaveTextContent('Your sign-in has expired');
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' })); expect(signOut).toHaveBeenCalledTimes(1);
  });
  it('a database that is not initialised (PGRST205) says so', () => {
    renderWith({ session, profileLoad: { state: 'error', code: 'PGRST205' } });
    expect(screen.getByRole('heading')).toHaveTextContent('DIRA LEARN is not set up yet');
  });
});
