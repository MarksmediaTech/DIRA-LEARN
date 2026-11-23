import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { Button } from '@/components/ui/Button';
import { applicationSchema, EDUCATION_LEVELS, type ApplicationInput } from './schema';
import type { Track } from '@/types/database';

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1 text-sm font-medium">{label}{children}
      {error && <span role="alert" className="text-xs font-normal text-danger">{error}</span>}
    </label>
  );
}
const input = 'rounded-control border border-purple-200 px-3 py-2 font-normal';

export function ApplicationForm() {
  const { session } = useAuth();
  const tracks = useQuery({
    queryKey: ['tracks'],
    queryFn: async () => {
      const { data, error } = await supabase.from('tracks').select('id, code, name, focus, position').order('position');
      if (error) throw error;
      return data as Track[];
    },
  });
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ApplicationInput>({ resolver: zodResolver(applicationSchema) });

  const submit = useMutation({
    mutationFn: async (values: ApplicationInput) => {
      if (!session) throw new Error('You need to sign in first');
      const { preferredTrackId } = values;
      const form = {
        firstName: values.firstName, lastName: values.lastName, dateOfBirth: values.dateOfBirth, phone: values.phone,
        location: values.location, educationLevel: values.educationLevel, institution: values.institution,
        skills: values.skills, interests: values.interests, motivation: values.motivation, consentGiven: true,
      };
      const { error } = await supabase.from('applications').insert({
        applicant_id: session.user.id, status: 'submitted', submitted_at: new Date().toISOString(),
        preferred_track_id: preferredTrackId || null, form_data: form,
      });
      if (error) throw error;
    },
  });

  if (submit.isSuccess) {
    return <p role="status" className="rounded-card bg-purple-50 p-6 text-purple-900">Application submitted. We will update your status here as it is reviewed.</p>;
  }

  return (
    <form onSubmit={handleSubmit((v) => submit.mutate(v))} className="grid max-w-2xl gap-4" noValidate>
      <h1 className="text-2xl font-bold text-purple-700">Apply to DIRA LEARN</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" error={errors.firstName?.message}><input className={input} {...register('firstName')} autoComplete="given-name" /></Field>
        <Field label="Last name" error={errors.lastName?.message}><input className={input} {...register('lastName')} autoComplete="family-name" /></Field>
        <Field label="Date of birth" error={errors.dateOfBirth?.message}><input type="date" className={input} {...register('dateOfBirth')} /></Field>
        <Field label="Phone" error={errors.phone?.message}><input type="tel" className={input} {...register('phone')} autoComplete="tel" /></Field>
        <Field label="Town or county" error={errors.location?.message}><input className={input} {...register('location')} /></Field>
        <Field label="Education level" error={errors.educationLevel?.message}>
          <select className={input} defaultValue="" {...register('educationLevel')}>
            <option value="" disabled>Choose one</option>
            {EDUCATION_LEVELS.map((l) => <option key={l} value={l}>{l[0]!.toUpperCase() + l.slice(1)}</option>)}
          </select>
        </Field>
      </div>
      <Field label="School, college or university (optional)" error={errors.institution?.message}><input className={input} {...register('institution')} /></Field>
      <Field label="Your skills" error={errors.skills?.message}><textarea rows={3} className={input} {...register('skills')} /></Field>
      <Field label="Your interests (optional)" error={errors.interests?.message}><textarea rows={2} className={input} {...register('interests')} /></Field>
      <Field label="Preferred track (you can change this later)" error={errors.preferredTrackId?.message}>
        <select className={input} defaultValue="" {...register('preferredTrackId')}>
          <option value="">No preference yet</option>
          {tracks.data?.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Field>
      <Field label="Why do you want to join DIRA LEARN?" error={errors.motivation?.message}><textarea rows={5} className={input} {...register('motivation')} /></Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" {...register('consent')} />
        <span>I agree that DIRA Foundation may use the information in this application to assess my application and run the programme.</span>
      </label>
      {errors.consent && <p role="alert" className="text-xs text-danger">{errors.consent.message}</p>}
      {submit.isError && <p role="alert" className="text-sm text-danger">{(submit.error as Error).message}</p>}
      <Button type="submit" disabled={isSubmitting || submit.isPending}>{submit.isPending ? 'Submitting…' : 'Submit application'}</Button>
    </form>
  );
}
