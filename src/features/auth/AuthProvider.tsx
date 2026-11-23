import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/types/database';
import { clearRecoveryPending } from './recoveryRules';
import { signInErrorMessage } from './accountStatus';
import { completeEnrolment, hasPendingEnrolment } from './enrolment';
import { PROFILE_TIMEOUT_MS, classifyProfileResult, errorCode, withTimeout, type ProfileLoad } from './profileLoad';

export interface AuthState {
  session: Session | null;
  profile: Profile | null;
  /** What happened to the profile request: loading, ready, missing (no row) or error (with a code). */
  profileLoad: ProfileLoad;
  loading: boolean;
  /** Loads the profile again (used by "Try again"). */
  reloadProfile: () => void;
  signIn: (email: string, password: string) => Promise<string | null>;
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthState | null>(null);

type ProfileResponse = { data: unknown; error: { code?: string; message?: string } | null };

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profileLoad, setProfileLoad] = useState<ProfileLoad>({ state: 'idle' });
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // A failed or rejected getSession() must not leave the app waiting: treat it as signed out.
    withTimeout<{ data: { session: Session | null } }>(supabase.auth.getSession(), PROFILE_TIMEOUT_MS)
      .then(({ data }) => setSession(data.session))
      .catch((e: unknown) => { console.error('DIRA LEARN: could not read the sign-in session', errorCode(e)); setSession(null); })
      .finally(() => setLoading(false));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // The profile is loaded per user, not per session object: token refreshes do not reload it or flash the waiting screen.
  const userId = session?.user.id ?? null;
  useEffect(() => {
    if (!userId) { setProfileLoad({ state: 'idle' }); return; }
    let cancelled = false;
    setProfileLoad({ state: 'loading' });
    // maybeSingle(): "no row" is a normal result (state 'missing'), not an error; every failure ends in a state with a code.
    withTimeout<ProfileResponse>(supabase.from('profiles').select('id, role, status, first_name, last_name, organization_id').eq('id', userId).maybeSingle(), PROFILE_TIMEOUT_MS)
      .then(({ data, error }) => {
        if (cancelled) return;
        const next = classifyProfileResult(userId, data, error);
        if (next.state === 'missing' || next.state === 'error') console.error('DIRA LEARN: account profile not loaded', next.state === 'error' ? next.code : 'PROFILE_MISSING');
        setProfileLoad(next);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const code = errorCode(e); console.error('DIRA LEARN: account profile request failed', code);
        setProfileLoad({ state: 'error', code });
      });
    return () => { cancelled = true; };
  }, [userId, attempt]);

  const reloadProfile = useCallback(() => setAttempt((n) => n + 1), []);
  // A loaded profile counts only for the user who is signed in now (another user signing in on this browser never sees it,
  // not even for one render before the new request starts).
  const current = useMemo<ProfileLoad>(() => (!userId ? { state: 'idle' }
    : profileLoad.state === 'ready' && profileLoad.profile.id !== userId ? { state: 'loading' } : profileLoad), [userId, profileLoad]);
  const profile = current.state === 'ready' ? current.profile : null;

  const value = useMemo<AuthState>(() => ({
    session, profile, profileLoad: current, loading, reloadProfile,
    signIn: async (email, password) => {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return signInErrorMessage(error.message);
        // A learner imported from CSV whose activation did not finish when they set their password: finish it now (the server
        // checks it is allowed), then load the profile again so the participant dashboard appears. A failure keeps them signed in.
        if (hasPendingEnrolment(data.user)) {
          const r = await completeEnrolment();
          if (!r.ok) console.error('DIRA LEARN: participant activation did not finish', r.message);
          setAttempt((n) => n + 1);
        }
        return null;
      } catch (e: unknown) {
        console.error('DIRA LEARN: sign-in request failed', errorCode(e));
        return 'We could not reach DIRA LEARN. Check your internet connection and try again.';
      }
    },
    signOut: async () => {
      clearRecoveryPending();
      try { await supabase.auth.signOut(); } catch (e: unknown) { console.error('DIRA LEARN: sign-out request failed', errorCode(e)); }
      setSession(null);   // signed out on this device even when the server could not be reached
    },
  }), [session, profile, current, loading, reloadProfile]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
