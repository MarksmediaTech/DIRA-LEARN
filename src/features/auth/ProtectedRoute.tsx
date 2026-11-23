import { Navigate, Outlet } from 'react-router-dom';
import type { RoleCode } from '@/types/database';
import { useAuth } from './AuthProvider';
import { isRecoveryPending } from './recoveryRules';
import { INACTIVE_MESSAGE } from './accountStatus';
import { profileProblemText } from './profileLoad';

interface Props { allow?: readonly RoleCode[] }

export function ProtectedRoute({ allow }: Props) {
  const { session, profile, profileLoad, loading, signOut, reloadProfile } = useAuth();
  if (loading || (session && (profileLoad.state === 'loading' || profileLoad.state === 'idle'))) {
    return <p role="status" className="p-8 text-purple-700">Loading your account…</p>;
  }
  if (!session) return <Navigate to="/login" replace />;
  const problem = profileProblemText(profileLoad);
  if (problem) {   // signed in, but the profile is missing or could not be loaded: never wait for ever
    return (
      <div className="grid max-w-xl gap-3 p-8">
        <h1 className="text-lg font-semibold text-purple-900">{problem.title}</h1>
        <p role="alert" className="text-sm text-ink">{problem.body}</p>
        <div className="flex gap-4">
          {problem.action === 'signin'
            ? <button type="button" className="text-sm font-semibold text-purple-700 underline" onClick={() => void signOut()}>Sign in again</button>
            : <>
                <button type="button" className="text-sm font-semibold text-purple-700 underline" onClick={reloadProfile}>Try again</button>
                <button type="button" className="text-sm font-semibold text-purple-700 underline" onClick={() => void signOut()}>Sign out</button>
              </>}
        </div>
      </div>);
  }
  if (isRecoveryPending()) return <Navigate to="/forgot-password" replace />;   // finish the password reset first
  if (!profile || profile.status !== 'active') {
    return (
      <div className="grid gap-3 p-8">
        <p role="alert" className="text-danger">{INACTIVE_MESSAGE}</p>
        <div><button type="button" className="text-sm font-semibold text-purple-700 underline" onClick={() => void signOut()}>Sign out</button></div>
      </div>);
  }
  if (allow && !allow.includes(profile.role)) {
    return <p role="alert" className="p-8 text-danger">You do not have access to this page.</p>;
  }
  return <Outlet />;
}
