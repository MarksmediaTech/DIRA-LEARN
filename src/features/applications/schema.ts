import { z } from 'zod';

export const EDUCATION_LEVELS = ['secondary', 'certificate', 'diploma', 'degree', 'other'] as const;

/** Whole years between dob and a reference date. */
export function ageOn(dob: Date, ref: Date): number {
  let age = ref.getFullYear() - dob.getFullYear();
  const beforeBirthday = ref.getMonth() < dob.getMonth() || (ref.getMonth() === dob.getMonth() && ref.getDate() < dob.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export const MIN_AGE = 18;
export const MAX_AGE = 25;

// Age limits come from the programme design (18-25). Other requirements are draft and should become configurable.
export const applicationSchema = z.object({
  firstName: z.string().trim().min(1, 'Enter your first name').max(80),
  lastName: z.string().trim().min(1, 'Enter your last name').max(80),
  dateOfBirth: z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Enter a valid date of birth')
    .refine((v) => {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return true;
      const age = ageOn(d, new Date());
      return age >= MIN_AGE && age <= MAX_AGE;
    }, `DIRA LEARN is for people aged ${MIN_AGE} to ${MAX_AGE}`),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a valid phone number'),
  location: z.string().trim().min(2, 'Enter your town or county').max(120),
  educationLevel: z.enum(EDUCATION_LEVELS, { errorMap: () => ({ message: 'Choose your education level' }) }),
  institution: z.string().trim().max(160).optional(),
  skills: z.string().trim().min(3, 'List at least one skill').max(600),
  interests: z.string().trim().max(600).optional(),
  preferredTrackId: z.string().uuid('Choose a preferred track').optional().or(z.literal('')),
  motivation: z.string().trim().min(50, 'Write at least 50 characters').max(1500, 'Keep it under 1500 characters'),
  consent: z.literal(true, { errorMap: () => ({ message: 'You must agree to the data use statement to apply' }) }),
});
export type ApplicationInput = z.infer<typeof applicationSchema>;

export const ALLOWED_DOC_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const MAX_DOC_BYTES = 5 * 1024 * 1024;

export function validateDocument(file: { type: string; size: number }): string | null {
  if (!(ALLOWED_DOC_TYPES as readonly string[]).includes(file.type)) return 'Upload a PDF, JPG or PNG file';
  if (file.size > MAX_DOC_BYTES) return 'File must be 5 MB or smaller';
  if (file.size === 0) return 'File is empty';
  return null;
}
