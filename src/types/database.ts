// Hand-written subset. Replace with `npm run db:types` output (database.generated.ts) once Supabase runs locally.
export const ROLE_CODES = [
  'super_admin', 'founder', 'co_founder', 'programme_director', 'programme_coordinator', 'trainer', 'me_officer', 'mentor', 'participant', 'applicant',
] as const;
export type RoleCode = (typeof ROLE_CODES)[number];
export type AccountStatus = 'pending' | 'active' | 'deactivated';
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';
export type DeliveryMode = 'online' | 'physical' | 'hybrid';
export type ApplicationStatus = 'draft' | 'submitted' | 'under_review' | 'shortlisted' | 'accepted' | 'rejected' | 'waitlisted';

export interface Profile {
  id: string; role: RoleCode; status: AccountStatus; first_name: string; last_name: string; organization_id: string | null;
}
export interface Track { id: string; code: string; name: string; focus: string | null; position: number }
export interface CurriculumSession {
  id: string; track_id: string | null; week_no: number; session_no: number; title: string; description: string | null;
  duration_minutes: number; objectives: string[]; topics: string[]; activities: string[]; expected_output: string | null;
  is_approved: boolean; source: string;
}

export interface Cohort {
  id: string; programme_id: string; name: string; start_date: string; end_date: string; capacity: number; archived: boolean;
  intake_label?: string | null; season?: string | null; recruitment_opens_on?: string | null; recruitment_closes_on?: string | null;
  access_opens_at?: string | null; access_closes_at?: string | null;
}
export type SessionStatus = 'scheduled' | 'completed' | 'cancelled' | 'rescheduled';
export interface ApplicationEvent { id: string; from_status: ApplicationStatus | null; to_status: ApplicationStatus | null; note: string | null; actor_id: string | null; created_at: string }

export type SubmissionStatus = 'submitted' | 'late' | 'returned' | 'graded';
export interface Assignment {
  id: string; cohort_id: string; track_id: string | null; title: string; instructions: string | null;
  due_at: string | null; allow_resubmission: boolean; max_score: number | null; component: 'task' | 'final_project' | 'reflection'; created_at: string;
}
export interface Submission {
  id: string; assignment_id: string; participant_id: string; attempt: number; body: string | null; storage_path: string | null;
  status: SubmissionStatus; feedback: string | null; score: number | null; submitted_at: string;
}

// ---- remaining modules ----
export interface MentorshipSession {
  id: string; assignment_id: string; held_on: string; summary: string | null; action_points: string[]; feedback: string | null; shared_with_mentee: boolean;
}
export interface MeIndicator { id: string; programme_id: string | null; name: string; definition: string | null; unit: string | null; target: number | null; is_active: boolean }
export type DataQuality = 'measured' | 'estimated' | 'missing';
export interface MeRecord { id: string; indicator_id: string; cohort_id: string | null; value: number | null; data_quality: DataQuality; recorded_on: string; note: string | null }
export interface Certificate {
  id: string; participant_id: string; cohort_id: string; certificate_no: string; issued_on: string; revoked: boolean; revoked_reason: string | null;
}
export interface GraduationRule {
  id: string; programme_id: string; min_sessions_attended: number | null; require_core_sessions: boolean; require_final_project: boolean;
  require_reflection: boolean; is_approved: boolean; approved_at: string | null;
}
export interface AlumniRecord { id: string; participant_id: string; employment_status: string | null; further_education: string | null; enterprise_activity: string | null; achievements: string | null; updated_at: string }
export interface AppNotification { id: string; kind: string; title: string; body: string | null; read_at: string | null; created_at: string }
export interface Announcement { id: string; cohort_id: string | null; title: string; body: string; created_at: string }
export type ProjectStatus = 'in_progress' | 'submitted' | 'needs_revision' | 'reviewed';
export interface Milestone { title: string; done: boolean }
export interface ParticipantProject {
  id: string; participant_id: string; track_id: string | null; title: string; description: string | null; milestones: Milestone[]; status: ProjectStatus; feedback: string | null; created_at: string;
}
export interface SystemSetting { key: string; value: unknown; is_approved: boolean; note: string | null; approved_at: string | null; updated_at: string }
export interface SafeguardingRecord {
  id: string; participant_id: string | null; summary: string; severity: 'low' | 'medium' | 'high' | null;
  status: 'open' | 'under_review' | 'acknowledged' | 'in_progress' | 'referred' | 'resolved' | 'closed'; created_at: string;
  // migration 24
  urgency: 'urgent' | 'standard'; source: string; source_report_id: string | null; conversation_id: string | null;
  reported_message: string | null; ack_due_at: string | null; acknowledged_at: string | null; responsible_officer: string | null;
  resolution: string | null; resolved_at: string | null; legal_hold: boolean; legal_hold_reason: string | null;
}
export interface AdminUser { id: string; email: string; role: RoleCode; status: AccountStatus; first_name: string; last_name: string; created_at: string; last_sign_in_at: string | null }

// ---- email ----
export type EmailStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'bounced' | 'complained' | 'failed' | 'cancelled';
export interface EmailTemplate { id: string; key: string; name: string; subject: string; body: string; is_system: boolean; is_active: boolean; updated_at: string }
export interface EmailOutboxRow {
  id: string; to_email: string; template_key: string | null; campaign: string | null; subject: string; status: EmailStatus; scheduled_for: string; attempts: number; error: string | null; sent_at: string | null; created_at: string;
}

// ---- courses ----
export type CourseFormat = 'online' | 'physical' | 'hybrid' | 'self_paced';
export type CourseStatus = 'draft' | 'published' | 'archived';
export type LessonKind = 'reading' | 'pdf' | 'presentation' | 'video' | 'link';
export interface Course {
  id: string; programme_id: string; track_id: string | null; cohort_id: string | null; title: string; summary: string | null;
  format: CourseFormat; status: CourseStatus; starts_on: string | null; ends_on: string | null; created_at: string;
}
export interface CourseModule { id: string; course_id: string; position: number; title: string; description: string | null }
export interface CourseLesson {
  id: string; module_id: string; position: number; title: string; kind: LessonKind; body: string | null; storage_path: string | null;
  external_url: string | null; mime_type: string | null; duration_minutes: number | null;
}
export interface CourseProgress { course_id: string; participant_id: string; lessons_total: number; lessons_done: number }
