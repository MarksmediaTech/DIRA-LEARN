import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext, type AuthState } from '@/features/auth/AuthProvider';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { LoginPage } from '@/features/auth/LoginPage';
import { SignUpPage } from '@/features/auth/SignUpPage';
import { COVER_PHOTOS } from '@/lib/site';

const auth = { session: null, profile: null, loading: false, signIn: async () => null, signOut: async () => {}, profileLoad: { state: 'idle' }, reloadProfile: () => {} } as unknown as AuthState;
const wrap = (ui: React.ReactElement) => render(<AuthContext.Provider value={auth}><MemoryRouter>{ui}</MemoryRouter></AuthContext.Provider>);
// the ambient background photos behind the page
const photos = () => Array.from(document.querySelectorAll('img[aria-hidden="true"]')) as HTMLImageElement[];

describe('animated website photos on the account pages', () => {
  it.each([
    ['sign in', <LoginPage key="l" />],
    ['create account', <SignUpPage key="s" />],
    ['set password frame', <AuthLayout key="a" title="Hello"><p>x</p></AuthLayout>],
  ])('%s shows every website photo behind the page, from the public site', (_n, ui) => {
    wrap(ui);
    expect(photos()).toHaveLength(COVER_PHOTOS.length);
    expect(photos().every((p) => p.src.startsWith('https://dirafoundationken.netlify.app/assets/photos/'))).toBe(true);
  });
  it('lets people pause and play the photos', async () => {
    wrap(<SignUpPage />);
    await userEvent.click(screen.getByRole('button', { name: /pause photos/i }));
    expect(screen.getByRole('button', { name: /play photos/i })).toBeInTheDocument();
  });
  it('drops a photo that fails to load instead of showing a broken image', () => {
    wrap(<SignUpPage />);
    fireEvent.error(photos()[0]!);
    expect(photos()).toHaveLength(COVER_PHOTOS.length - 1);
  });
});

describe('photographs are shown whole, never cropped or zoomed (23 Nov 2026)', () => {
  it('the background photographs use object-contain and never object-cover or the zoom animation', () => {
    wrap(<SignUpPage />);
    expect(photos().length).toBeGreaterThan(0);
    expect(photos().every((p) => p.className.includes('object-contain') && !/object-cover|kenburns|animate-/.test(p.className))).toBe(true);
  });
  it('sign-in page keeps its original composition: photos only behind the page, no photograph inside the content columns', () => {
    wrap(<LoginPage />);
    expect(photos()).toHaveLength(COVER_PHOTOS.length);
    expect(document.querySelector('[data-photo-frame]')).toBeNull();
    const content = document.querySelector('section.animate-rise-in') as HTMLElement;
    expect(content.querySelector('img[src*="/assets/photos/"], img[aria-hidden="true"]')).toBeNull();
    // the values, heading and the sign-in card are all still there
    expect(screen.getByRole('heading', { name: /your journey/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Welcome Back' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Our values' })).toBeInTheDocument();
  });
});
