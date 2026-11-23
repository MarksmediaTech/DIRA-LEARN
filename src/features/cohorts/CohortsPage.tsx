import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/features/auth/AuthProvider';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { isStaffRole } from '@/lib/permissions';
import type { Cohort } from '@/types/database';
import { cohortSchema, type CohortInput } from './schema';
import { seatsLeft } from './rules';
import { canManageAccess, optionalLocalToIso } from './accessRules';
import { useProgrammeTimezone } from './useProgrammeTimezone';

interface CapacityRow { cohort_id: string; enrolled: number }
const input = 'rounded-control border border-purple-200 px-3 py-2 font-normal';

export function CohortsPage() {
  const { profile } = useAuth();
  const { tz } = useProgrammeTimezone();
  const canSetAccess = canManageAccess(profile?.role);
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const staff = profile ? isStaffRole(profile.role) : false;

  const cohorts = useQuery({
    queryKey: ['cohorts'],
    queryFn: async () => {
      const [c, cap] = await Promise.all([
        supabase.from('cohorts').select('id, programme_id, name, start_date, end_date, capacity, archived, intake_label, season, recruitment_opens_on, recruitment_closes_on, access_opens_at, access_closes_at').order('start_date', { ascending: false }),
        supabase.from('v_cohort_capacity').select('cohort_id, enrolled'),
      ]);
      if (c.error) throw c.error;
      if (cap.error) throw cap.error;
      const enrolled = new Map((cap.data as CapacityRow[]).map((r) => [r.cohort_id, r.enrolled]));
      return (c.data as Cohort[]).map((x) => ({ ...x, enrolled: enrolled.get(x.id) ?? 0 }));
    },
  });

  const { register, handleSubmit, reset, formState: { errors } } = useForm<CohortInput>({ resolver: zodResolver(cohortSchema) });
  const create = useMutation({
    mutationFn: async (v: CohortInput) => {
      const { data: prog, error: pe } = await supabase.from('programmes').select('id').limit(1).single();
      if (pe) throw pe;
      const { error } = await supabase.from('cohorts').insert({ programme_id: prog.id, name: v.name, start_date: v.startDate, end_date: v.endDate, capacity: v.capacity,
        intake_label: v.intakeLabel || null, season: v.season || null,
        recruitment_opens_on: v.recruitmentOpensOn || null, recruitment_closes_on: v.recruitmentClosesOn || null,
        ...(canManageAccess(profile?.role) ? { access_opens_at: optionalLocalToIso(v.accessOpensAt, tz), access_closes_at: optionalLocalToIso(v.accessClosesAt, tz) } : {}) });
      if (error) throw error;
    },
    onSuccess: () => { reset(); setShowForm(false); void qc.invalidateQueries({ queryKey: ['cohorts'] }); },
  });

  if (cohorts.isLoading) return <p role="status">Loading cohorts…</p>;
  if (cohorts.isError) return <p role="alert" className="text-danger">Could not load cohorts. Check your connection and try again.</p>;
  const shown = (cohorts.data ?? []).filter((c) => showArchived || !c.archived);

  return (
    <section className="grid max-w-4xl gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-purple-700">Cohorts</h1>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show archived</label>
          {staff && <Button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Close' : 'New cohort'}</Button>}
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit((v) => create.mutate(v))} noValidate className="grid gap-3 rounded-card border border-purple-100 p-5 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium sm:col-span-2">Cohort name<input className={input} {...register('name')} />{errors.name && <span role="alert" className="text-danger">{errors.name.message}</span>}</label>
          <label className="grid gap-1 text-sm font-medium">Start date<input type="date" className={input} {...register('startDate')} />{errors.startDate && <span role="alert" className="text-danger">{errors.startDate.message}</span>}</label>
          <label className="grid gap-1 text-sm font-medium">End date<input type="date" className={input} {...register('endDate')} />{errors.endDate && <span role="alert" className="text-danger">{errors.endDate.message}</span>}</label>
          <label className="grid gap-1 text-sm font-medium">Capacity (places)<input type="number" min={1} className={input} {...register('capacity')} />{errors.capacity && <span role="alert" className="text-danger">{errors.capacity.message}</span>}</label>
          <label className="grid gap-1 text-sm font-medium">Intake name (optional)<input className={input} placeholder="For example November 2026 intake" {...register('intakeLabel')} />{errors.intakeLabel && <span role="alert" className="text-danger">{errors.intakeLabel.message}</span>}</label>
          <label className="grid gap-1 text-sm font-medium">Programme season (optional)<input className={input} {...register('season')} />{errors.season && <span role="alert" className="text-danger">{errors.season.message}</span>}</label>
          <label className="grid gap-1 text-sm font-medium">Recruitment opens<input type="date" className={input} {...register('recruitmentOpensOn')} /></label>
          <label className="grid gap-1 text-sm font-medium">Recruitment closes<input type="date" className={input} {...register('recruitmentClosesOn')} />{errors.recruitmentClosesOn && <span role="alert" className="text-danger">{errors.recruitmentClosesOn.message}</span>}</label>
          {canSetAccess ? (<>
          <label className="grid gap-1 text-sm font-medium">Learning portal opens<input type="datetime-local" className={input} {...register('accessOpensAt')} /></label>
          <label className="grid gap-1 text-sm font-medium">Learning portal closes<input type="datetime-local" className={input} {...register('accessClosesAt')} />{errors.accessClosesAt && <span role="alert" className="text-danger">{errors.accessClosesAt.message}</span>}</label>
          <p className="text-xs text-ink/70 sm:col-span-2">Times are in the programme time zone ({tz}). Learners enrolled in this cohort cannot open programme materials or assignments until the portal opening time. Leave it empty to keep access closed until it is set.</p>
          </>) : <p className="text-xs text-ink/70 sm:col-span-2">Learning-portal access times are set by a super administrator, Founder, Co-Founder or programme director. Until then, learners in this cohort have no access.</p>}
          <div className="flex items-end gap-3"><Button type="submit" disabled={create.isPending}>Create cohort</Button></div>
          {create.isError && <p role="alert" className="text-sm text-danger sm:col-span-2">{(create.error as Error).message}</p>}
        </form>
      )}

      {shown.length === 0
        ? <EmptyState title="No cohorts yet">{staff ? 'Create the first cohort to start enrolling and scheduling.' : 'Cohorts you are assigned to will appear here.'}</EmptyState>
        : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {shown.map((c) => (
              <li key={c.id}>
                <Link to={`/cohorts/${c.id}`} className="block rounded-card border border-purple-100 p-4 hover:bg-purple-50">
                  <p className="font-display text-lg font-semibold text-purple-900">{c.name}{c.archived && <span className="ml-2 text-xs font-normal text-ink/60">(archived)</span>}</p>
                  <p className="text-sm text-ink/70">{c.start_date} to {c.end_date}</p>
                  <p className="mt-2 text-sm"><strong>{c.enrolled}</strong> of {c.capacity} places filled · {seatsLeft({ capacity: c.capacity, enrolled: c.enrolled })} left</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}
