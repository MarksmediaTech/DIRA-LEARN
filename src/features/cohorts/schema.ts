import { z } from 'zod';
import { validateAccessWindow } from './accessRules';

export const cohortSchema = z.object({
  name: z.string().trim().min(2, 'Enter a cohort name').max(120),
  startDate: z.string().min(1, 'Choose a start date'),
  endDate: z.string().min(1, 'Choose an end date'),
  capacity: z.coerce.number({ invalid_type_error: 'Enter a number' }).int('Whole numbers only').min(1, 'At least 1').max(500),
  intakeLabel: z.string().trim().max(80, 'At most 80 characters').optional(),
  season: z.string().trim().max(80, 'At most 80 characters').optional(),
  recruitmentOpensOn: z.string().optional(),
  recruitmentClosesOn: z.string().optional(),
  accessOpensAt: z.string().optional(),
  accessClosesAt: z.string().optional(),
}).refine((v) => v.endDate >= v.startDate, { path: ['endDate'], message: 'The end date cannot be before the start date' })
  .refine((v) => !v.recruitmentOpensOn || !v.recruitmentClosesOn || v.recruitmentClosesOn >= v.recruitmentOpensOn, { path: ['recruitmentClosesOn'], message: 'Recruitment cannot close before it opens' })
  .refine((v) => !validateAccessWindow(v.accessOpensAt, v.accessClosesAt), { path: ['accessClosesAt'], message: 'Access must close after it opens' });
export type CohortInput = z.infer<typeof cohortSchema>;

export const scheduleSchema = z.object({
  curriculumSessionId: z.string().uuid('Choose a session'),
  trainerId: z.string().uuid().optional().or(z.literal('')),
  startsAt: z.string().min(1, 'Choose a start time'),
  endsAt: z.string().min(1, 'Choose an end time'),
  mode: z.enum(['physical', 'online', 'hybrid']),
  venue: z.string().trim().max(160).optional(),
  meetingUrl: z.string().trim().max(500).optional()
    .refine((v) => !v || /^https?:\/\/\S+$/i.test(v), 'Enter a full link starting with https://'),
});
export type ScheduleInput = z.infer<typeof scheduleSchema>;
