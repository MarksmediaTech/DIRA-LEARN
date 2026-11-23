// Browser test harness: the real LoginPage, SignUpPage, ForgotPasswordPage, AuthProvider and ProtectedRoute, with the simulated client above.
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { LoginPage } from '@/features/auth/LoginPage';
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { SignUpPage } from '@/features/auth/SignUpPage';
import { SetupPage } from '@/features/auth/SetupPage';
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage';
import { SetPasswordPage } from '@/features/auth/SetPasswordPage';
import { ImportPage } from '@/features/import/ImportPage';
import { useAuth } from '@/features/auth/AuthProvider';
function Home() { const { profile } = useAuth(); return <><h1>Dashboard (signed in)</h1><p data-testid="role">{profile?.role ?? ''}</p></>; }
createRoot(document.getElementById('root')!).render(
  <AuthProvider><BrowserRouter><Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
    <Route path="/signup" element={<SignUpPage />} />
    <Route path="/setup" element={<SetupPage />} />
    <Route path="/set-password" element={<SetPasswordPage />} />
    <Route path="/import" element={<ImportPage />} />
    <Route element={<ProtectedRoute />}><Route path="/" element={<Home />} /><Route path="/account/password" element={<ChangePasswordPage />} /></Route>
  </Routes></BrowserRouter></AuthProvider>,
);
