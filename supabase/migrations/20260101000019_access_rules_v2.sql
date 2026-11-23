-- DIRA LEARN: management decisions on learning access (follow-up to migration 18).
-- STATUS: written, NOT yet executed. Local first: `supabase db reset` then `supabase test db`. Never run first on production.
--
-- DECISIONS IMPLEMENTED (accepted by DIRA, see docs/COHORT_ACCESS.md)
--   1. One programme time zone. programmes.timezone, default 'Africa/Nairobi' (the existing reminder emails already use it).
--      Access times are exact moments; the time zone only decides how they are entered, shown and written in emails.
--   2. A withdrawn learner is treated as Suspended (learning access closes automatically; the record, certificates and profile stay).
--   3. Only a super administrator, Founder, Co-Founder or programme director can extend, shorten or suspend access, and only they can
--      set a cohort's access times. Other staff (coordinator) still see the access roster.
--   4. Reminder emails: 3 days before access opens, 7 days before it closes, and an in-app note plus email whenever one learner's access
--      is changed. Emails only go out when automatic email is approved (existing `email_automation` setting) and never include the
--      staff reason.
--   5. After access expires a learner can still READ their own results (submissions with scores and feedback, assessment results,
--      and the assignment titles and marks they belong to). They cannot submit, and learning materials and stored files stay closed.
--      Scheduled, pending and suspended learners get none of this.

-- ============ 1. programme time zone ============
alter table programmes add column if not exists timezone text not null default 'Africa/Nairobi';
create or replace function guard_programme_timezone() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown time zone: %', new.timezone;
  end if;
  return new;
end $$;
drop trigger if exists trg_programme_timezone on programmes;
create trigger trg_programme_timezone before insert or update of timezone on programmes for each row execute function guard_programme_timezone();

-- ============ 2. who may change access ============
create or replace function can_manage_learner_access() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(app_role() in ('super_admin', 'founder', 'co_founder', 'programme_director'), false) $$;
revoke all on function can_manage_learner_access() from public, anon;
grant execute on function can_manage_learner_access() to authenticated;

-- Rewrite migration 18's functions from their stored source; abort if the expected text is missing.
do $$
declare
  r record; def text; newdef text;
begin
  for r in
    select * from (values
      ('set_learner_access_override(uuid,uuid,timestamptz,timestamptz,text)',
       'if not is_staff() then raise exception ''Only programme staff can change learner access''; end if;',
       'if not can_manage_learner_access() then raise exception ''Only a super administrator, Founder, Co-Founder or programme director can change learner access''; end if;'),
      ('set_learner_suspension(uuid,uuid,boolean,text)',
       'if not is_staff() then raise exception ''Only programme staff can change learner access''; end if;',
       'if not can_manage_learner_access() then raise exception ''Only a super administrator, Founder, Co-Founder or programme director can change learner access''; end if;'),
      ('learner_access_state(uuid,uuid)',
       'select * into a from learner_access where participant_id = p_participant and cohort_id = p_cohort;',
       'if exists (select 1 from participants where id = p_participant and status = ''withdrawn'') then return ''suspended''; end if;' || E'\n  ' ||
       'select * into a from learner_access where participant_id = p_participant and cohort_id = p_cohort;')
    ) as t(sig, old_txt, new_txt)
  loop
    def := pg_get_functiondef(('public.' || r.sig)::regprocedure);
    newdef := replace(def, r.old_txt, r.new_txt);
    if newdef = def then raise exception 'Migration 19: expected text not found in function %, nothing was changed', r.sig; end if;
    execute newdef;
  end loop;
end $$;

-- A cohort's access times decide who can open the portal, so they follow the same rule.
create or replace function guard_cohort_access_times() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if is_trusted_session() then return new; end if;
  if (tg_op = 'INSERT' and (new.access_opens_at is not null or new.access_closes_at is not null))
     or (tg_op = 'UPDATE' and (new.access_opens_at, new.access_closes_at) is distinct from (old.access_opens_at, old.access_closes_at)) then
    if not can_manage_learner_access() then
      raise exception 'Only a super administrator, Founder, Co-Founder or programme director can set a cohort''s access times';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_cohort_access_times on cohorts;
create trigger trg_cohort_access_times before insert or update on cohorts for each row execute function guard_cohort_access_times();

-- ============ 3. results stay readable (read-only) after expiry ============
create or replace function participant_access_expired() returns boolean language sql stable security definer set search_path = public as $$
  select case when app_role() = 'participant' then exists (
    select 1 from cohort_enrolments e join participants p on p.id = e.participant_id
    where p.profile_id = auth.uid() and learner_access_state(e.participant_id, e.cohort_id) = 'expired')
  else false end $$;
revoke all on function participant_access_expired() from public, anon;
grant execute on function participant_access_expired() to authenticated;

do $$ declare t text; begin
  foreach t in array array['assignments', 'submissions', 'assessment_results']
  loop
    execute format('drop policy if exists %I on %I', t || '_access_window', t);
    -- reading: open while Active, and read-only after Expired
    execute format('create policy %I on %I as restrictive for select to authenticated using ((select participant_access_active()) or (select participant_access_expired()))', t || '_access_read', t);
    -- writing: only while Active
    execute format('create policy %I on %I as restrictive for insert to authenticated with check ((select participant_access_active()))', t || '_access_ins', t);
    execute format('create policy %I on %I as restrictive for update to authenticated using ((select participant_access_active())) with check ((select participant_access_active()))', t || '_access_upd', t);
    execute format('create policy %I on %I as restrictive for delete to authenticated using ((select participant_access_active()))', t || '_access_del', t);
  end loop;
end $$;

-- ============ 4. emails and in-app notes ============
insert into email_templates(key, name, subject, body, is_system) values
 ('access_opening_reminder', 'Learning access opens soon', 'Your learning access to {{cohort_name}} opens on {{access_date}}', E'Hello {{first_name}},\n\nYour learning access to {{cohort_name}} opens on {{access_date}}. Until then you can sign in, but programme materials stay closed.', true),
 ('access_closing_reminder', 'Learning access closes soon', 'Your learning access to {{cohort_name}} ends on {{access_date}}', E'Hello {{first_name}},\n\nYour learning access to {{cohort_name}} ends on {{access_date}}. Please finish and submit your work before then. You will still be able to view your results and certificate afterwards.', true),
 ('access_changed', 'Learning access changed', '{{change_title}}', E'Hello {{first_name}},\n\n{{change_body}}\n\nSign in to DIRA Learn for details.', true)
on conflict (key) do nothing;

-- One learner's access changed: tell that learner. The staff reason is internal and is never included.
create or replace function notify_access_change() returns trigger language plpgsql security definer set search_path = public as $$
declare uid uuid; cname text; tz text; ttl text; msg text; fmt constant text := 'FMDay DD Mon YYYY HH24:MI';
begin
  select pa.profile_id into uid from participants pa where pa.id = new.participant_id;
  select c.name, g.timezone into cname, tz from cohorts c join programmes g on g.id = c.programme_id where c.id = new.cohort_id;
  if uid is null or cname is null then return new; end if;
  if new.action = 'suspended' then
    ttl := 'Your learning access is paused'; msg := 'Your access to ' || cname || ' has been paused. Please contact the programme team.';
  elsif new.action = 'reinstated' then
    ttl := 'Your learning access is restored'; msg := 'Your access to ' || cname || ' is open again.';
  elsif new.action = 'override_cleared' then
    ttl := 'Your learning access dates changed'; msg := 'Your access to ' || cname || ' now follows the cohort dates.';
  else
    ttl := 'Your learning access dates changed';
    msg := 'Your access to ' || cname || ' has new dates.'
      || coalesce(' Opens: ' || to_char(new.opens_at at time zone tz, fmt) || '.', '')
      || coalesce(' Closes: ' || to_char(new.closes_at at time zone tz, fmt) || '.', '')
      || ' (Times are in ' || tz || '.)';
  end if;
  insert into notifications(user_id, kind, title, body) values (uid, 'access', ttl, msg);
  if email_automation_enabled() and not exists (select 1 from profiles where id = uid and email_opt_out) then
    perform _enqueue_email(uid, 'access_changed', jsonb_build_object('cohort_name', cname, 'change_title', ttl, 'change_body', msg), now(), 'event:access', null);
  end if;
  return new;
end $$;
drop trigger if exists trg_notify_access_change on learner_access_events;
create trigger trg_notify_access_change after insert on learner_access_events for each row execute function notify_access_change();

-- Scheduled reminders (service role only; the send-emails function calls it after queue_reminders).
create or replace function queue_access_reminders() returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; new_id uuid; kind_key text; fmt constant text := 'FMDay DD Mon YYYY HH24:MI';
begin
  if not email_automation_enabled() then return 0; end if;
  for r in
    select pa.profile_id as uid, e.cohort_id, c.name as cohort_name, g.timezone as tz,
           coalesce(a.opens_at_override, c.access_opens_at) as opens, coalesce(a.closes_at_override, c.access_closes_at) as closes
    from cohort_enrolments e
    join cohorts c on c.id = e.cohort_id
    join programmes g on g.id = c.programme_id
    join participants pa on pa.id = e.participant_id
    join profiles pr on pr.id = pa.profile_id
    left join learner_access a on a.participant_id = e.participant_id and a.cohort_id = e.cohort_id
    where pa.status <> 'withdrawn' and not coalesce(a.suspended, false) and not pr.email_opt_out and pr.status = 'active'
  loop
    if r.opens is not null and r.opens > now() and r.opens <= now() + interval '3 days' then
      kind_key := 'access_open:' || to_char(r.opens at time zone 'UTC', 'YYYYMMDDHH24MI');
      if not exists (select 1 from email_reminder_log l where l.kind = kind_key and l.ref_id = r.cohort_id and l.user_id = r.uid) then
        new_id := _enqueue_email(r.uid, 'access_opening_reminder', jsonb_build_object('cohort_name', r.cohort_name,
          'access_date', to_char(r.opens at time zone r.tz, fmt) || ' (' || r.tz || ')'), now(), 'reminder:access', null);
        insert into email_reminder_log(kind, ref_id, user_id) values (kind_key, r.cohort_id, r.uid) on conflict do nothing;
        if new_id is not null then n := n + 1; end if;
      end if;
    end if;
    if r.closes is not null and r.closes > now() and r.closes <= now() + interval '7 days' and (r.opens is not null and r.opens <= now()) then
      kind_key := 'access_close:' || to_char(r.closes at time zone 'UTC', 'YYYYMMDDHH24MI');
      if not exists (select 1 from email_reminder_log l where l.kind = kind_key and l.ref_id = r.cohort_id and l.user_id = r.uid) then
        new_id := _enqueue_email(r.uid, 'access_closing_reminder', jsonb_build_object('cohort_name', r.cohort_name,
          'access_date', to_char(r.closes at time zone r.tz, fmt) || ' (' || r.tz || ')'), now(), 'reminder:access', null);
        insert into email_reminder_log(kind, ref_id, user_id) values (kind_key, r.cohort_id, r.uid) on conflict do nothing;
        if new_id is not null then n := n + 1; end if;
      end if;
    end if;
  end loop;
  return n;
end $$;
revoke all on function queue_access_reminders() from public, anon, authenticated;
grant execute on function queue_access_reminders() to service_role;
