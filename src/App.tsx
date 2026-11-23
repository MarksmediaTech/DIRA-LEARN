import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { ProtectedRoute } from '@/features/auth/ProtectedRoute';
import { LoginPage } from '@/features/auth/LoginPage';
import { AppShell } from '@/components/ui/AppShell';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { ApplicationForm } from '@/features/applications/ApplicationForm';
import { TrackSelectionPage } from '@/features/tracks/TrackSelectionPage';
import { CurriculumPage } from '@/features/curriculum/CurriculumPage';
import { ApplicationsReviewPage } from '@/features/applications/ApplicationsReviewPage';
import { ApprovalCenterPage } from '@/features/curriculum/ApprovalCenterPage';
import { CohortsPage } from '@/features/cohorts/CohortsPage';
import { CohortDetailPage } from '@/features/cohorts/CohortDetailPage';
import { CurriculumAdminPage } from '@/features/curriculum/CurriculumAdminPage';
import { SessionsPage } from '@/features/sessions/SessionsPage';
import { SessionDetailPage } from '@/features/sessions/SessionDetailPage';
import { AssignmentsPage } from '@/features/assignments/AssignmentsPage';
import { AssignmentDetailPage } from '@/features/assignments/AssignmentDetailPage';
import { ResourcesPage } from '@/features/resources/ResourcesPage';
import { ResultsPage } from '@/features/results/ResultsPage';
import { PerformancePage } from '@/features/performance/PerformancePage';
import { IntelligencePage } from '@/features/intelligence/IntelligencePage';
import { AttendancePage } from '@/features/attendance/AttendancePage';
import { MentorshipPage } from '@/features/mentorship/MentorshipPage';
import { MePage } from '@/features/me/MePage';
import { CertificatesPage } from '@/features/certificates/CertificatesPage';
import { VerifyPage } from '@/features/certificates/VerifyPage';
import { AlumniPage } from '@/features/alumni/AlumniPage';
import { ChatPage } from '@/features/chat/ChatPage';
import { BriefsPage } from '@/features/briefs/BriefsPage';
import { ModerationPage } from '@/features/connect/ModerationPage';
import { ProjectsPage } from '@/features/projects/ProjectsPage';
import { UsersPage } from '@/features/admin/UsersPage';
import { SettingsPage } from '@/features/admin/SettingsPage';
import { AuditPage } from '@/features/admin/AuditPage';
import { SafeguardingPage } from '@/features/admin/SafeguardingPage';
import { CalendarPage } from '@/features/calendar/CalendarPage';
import { AnalyticsPage } from '@/features/analytics/AnalyticsPage';
import { EmailsPage } from '@/features/emails/EmailsPage';
import { CoursesPage } from '@/features/courses/CoursesPage';
import { CourseDetailPage } from '@/features/courses/CourseDetailPage';
import { SignUpPage } from '@/features/auth/SignUpPage';
import { SetPasswordPage } from '@/features/auth/SetPasswordPage';
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { SetupPage } from '@/features/auth/SetupPage';
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage';
import { ImportPage } from '@/features/import/ImportPage';
import { NAV_ITEMS } from '@/lib/permissions';
import { configProblem } from '@/lib/supabase';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } });
const rolesFor = (path: string) => NAV_ITEMS.find((i) => i.path === path)!.roles;

export function App() {
  // A production build with missing or local database settings stops here instead of contacting the wrong system.
  if (configProblem) {
    return (
      <main role="alert" className="mx-auto max-w-xl p-8 text-dira-deep">
        <h1 className="text-2xl font-bold">DIRA LEARN is not available right now</h1>
        <p className="mt-3">The site is being set up. Please try again later or contact the DIRA Foundation programme team.</p>
        <p className="mt-3 text-sm text-dira-deep/60">For the site administrator: {configProblem} Set them in the hosting settings and rebuild.</p>
      </main>
    );
  }
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignUpPage />} />
            <Route path="/set-password" element={<SetPasswordPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/verify" element={<VerifyPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<AppShell />}>
                <Route index element={<DashboardPage />} />
                <Route path="account/password" element={<ChangePasswordPage />} />
                <Route element={<ProtectedRoute allow={rolesFor('/application')} />}><Route path="application" element={<ApplicationForm />} /></Route>
                <Route element={<ProtectedRoute allow={rolesFor('/tracks')} />}><Route path="tracks" element={<TrackSelectionPage />} /></Route>
                <Route element={<ProtectedRoute allow={rolesFor('/curriculum')} />}><Route path="curriculum" element={<CurriculumPage />} /></Route>
                <Route element={<ProtectedRoute allow={rolesFor('/applications')} />}><Route path="applications" element={<ApplicationsReviewPage />} /></Route>
                <Route element={<ProtectedRoute allow={rolesFor('/cohorts')} />}>
                  <Route path="cohorts" element={<CohortsPage />} />
                  <Route path="cohorts/:cohortId" element={<CohortDetailPage />} />
                </Route>
                <Route element={<ProtectedRoute allow={rolesFor('/curriculum/manage')} />}><Route path="curriculum/manage" element={<CurriculumAdminPage />} /></Route>
                <Route element={<ProtectedRoute allow={rolesFor('/curriculum/approval')} />}><Route path="curriculum/approval" element={<ApprovalCenterPage />} /></Route>
                <Route element={<ProtectedRoute allow={rolesFor('/sessions')} />}>
                  <Route path="sessions" element={<SessionsPage />} />
                  <Route path="sessions/:scheduleId" element={<SessionDetailPage />} />
                </Route>
                <Route element={<ProtectedRoute allow={rolesFor('/resources')} />}><Route path="resources" element={<ResourcesPage />} /></Route>
                <Route element={<ProtectedRoute allow={rolesFor('/assignments')} />}>
                  <Route path="assignments" element={<AssignmentsPage />} />
                  <Route path="assignments/:assignmentId" element={<AssignmentDetailPage />} />
                </Route>
                <Route element={<ProtectedRoute allow={rolesFor('/results')} />}><Route path="results" element={<ResultsPage />} /></Route>
                <Route element={<ProtectedRoute allow={rolesFor('/performance')} />}><Route path="performance" element={<PerformancePage />} /></Route>
                <Route element={<ProtectedRoute allow={rolesFor('/intelligence')} />}><Route path="intelligence" element={<IntelligencePage />} /></Route>
                <Route element={<ProtectedRoute allow={rolesFor('/attendance')} />}><Route path="attendance" element={<AttendancePage />} /></Route>
                <Route element={<ProtectedRoute allow={rolesFor('/courses')} />}>
                  <Route path="courses" element={<CoursesPage />} />
                  <Route path="courses/:courseId" element={<CourseDetailPage />} />
                </Route>
                <Route element={<ProtectedRoute allow={rolesFor('/projects')} />}><Route path="projects" element={<ProjectsPage />} /></Route>
                <Route element={<ProtectedRoute allow={rolesFor('/mentorship')} />}><Route path="mentorship" element={<MentorshipPage />} /></Route>
                <Route element={<ProtectedRoute allow={rolesFor('/certificates')} />}><Route path="certificates" element={<CertificatesPage />} /></Route>
                <Route element={<ProtectedRoute allow={rolesFor('/alumni')} />}><Route path="alumni" element={<AlumniPage />} /></Route>
                <Route element={<ProtectedRoute allow={rolesFor('/me')} />}><Route path="me" element={<MePage />} /></Route>
                <Route element={<ProtectedRoute allow={rolesFor('/calendar')} />}><Route path="calendar" element={<CalendarPage />} /></Route>
                <Route element={<ProtectedRoute allow={rolesFor('/analytics')} />}><Route path="analytics" element={<AnalyticsPage />} /></Route>
                <Route element={<ProtectedRoute allow={rolesFor('/emails')} />}><Route path="emails" element={<EmailsPage />} /></Route>
                <Route element={<ProtectedRoute allow={rolesFor('/import')} />}><Route path="import" element={<ImportPage />} /></Route>
                <Route element={<ProtectedRoute allow={rolesFor('/users')} />}><Route path="users" element={<UsersPage />} /></Route>
                <Route element={<ProtectedRoute allow={rolesFor('/settings')} />}><Route path="settings" element={<SettingsPage />} /></Route>
                <Route element={<ProtectedRoute allow={rolesFor('/audit')} />}><Route path="audit" element={<AuditPage />} /></Route>
                <Route element={<ProtectedRoute allow={rolesFor('/safeguarding')} />}><Route path="safeguarding" element={<SafeguardingPage />} /></Route>
                <Route element={<ProtectedRoute allow={rolesFor('/chat')} />}><Route path="chat" element={<ChatPage />} /></Route>
                {/* 22 Nov 2026: the old pages lead to Chat; notifications are in the bell at the top right */}
                <Route path="connect" element={<Navigate to="/chat?section=direct" replace />} />
                <Route element={<ProtectedRoute allow={rolesFor('/connect/moderation')} />}><Route path="connect/moderation" element={<ModerationPage />} /></Route>
                <Route element={<ProtectedRoute allow={rolesFor('/briefs')} />}><Route path="briefs" element={<BriefsPage />} /></Route>
                <Route path="announcements" element={<Navigate to="/chat?section=announcements" replace />} />
                <Route path="notifications" element={<Navigate to="/" replace />} />
              </Route>
            </Route>
            <Route path="*" element={<p className="p-8">Page not found.</p>} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
