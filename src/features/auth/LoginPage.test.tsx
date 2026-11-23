import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthContext, type AuthState } from './AuthProvider';
import { LoginPage } from './LoginPage';

function renderLogin(over: Partial<AuthState> = {}) {
  const value = { session: null, profile: null, loading: false, signIn: async () => null, signOut: async () => {}, profileLoad: { state: 'idle' }, reloadProfile: () => {}, ...over } as AuthState;
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={['/login']}>
        <Routes><Route path="/login" element={<LoginPage />} /><Route path="/" element={<p>home</p>} /></Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('LoginPage', () => {
  it('passes the typed email and password to signIn', async () => {
    const signIn = vi.fn(async () => null);
    renderLogin({ signIn });
    await userEvent.type(screen.getByLabelText(/email address/i), 'a@b.org');
    await userEvent.type(document.getElementById('login-password') as HTMLInputElement, 'secret');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(signIn).toHaveBeenCalledWith('a@b.org', 'secret'));
  });
  it('shows the error returned by signIn', async () => {
    renderLogin({ signIn: async () => 'Invalid login credentials' });
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials');
  });
  it('toggles password visibility', async () => {
    renderLogin();
    const pw = document.getElementById('login-password') as HTMLInputElement;
    expect(pw.type).toBe('password');
    await userEvent.click(screen.getByRole('button', { name: /show password/i }));
    expect(pw.type).toBe('text');
  });
  it('redirects an existing session to the app', () => {
    renderLogin({ session: {} as AuthState['session'] });
    expect(screen.getByText('home')).toBeInTheDocument();
  });
  it('shows the footer and tagline', () => {
    renderLogin();
    expect(screen.getByText('© 2026 DIRA Foundation. All rights reserved.')).toBeInTheDocument();
    expect(screen.getByText('Education • Empowerment • Opportunity')).toBeInTheDocument();
  });
  it('shows the four website values as real, readable content', () => {
    renderLogin();
    const list = screen.getByRole('list', { name: /our values/i });
    for (const t of ['Every voice matters', 'Future-ready skills', 'Led by practitioners', 'Impact first']) expect(within(list).getByRole('heading', { name: t })).toBeInTheDocument();
  });
  it('links new learners to the create-account page', () => {
    renderLogin();
    expect(screen.getByRole('link', { name: /create an account/i })).toHaveAttribute('href', '/signup');
  });
  it('links back to the DIRA Foundation website', () => {
    renderLogin();
    expect(screen.getByRole('link', { name: /back to the dira foundation website/i })).toHaveAttribute('href', 'https://dirafoundationken.netlify.app');
  });
});
