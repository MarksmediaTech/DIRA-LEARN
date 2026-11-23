-- pgTAP tests for migration 39: Super Administrators hold interim safeguarding access until a Lead or Deputy is appointed
-- (owner decision 21 Nov 2026). LOCAL database only: `supabase db reset` then `supabase test db`. Everything rolls back.
begin;
select plan(24);

create function _u(n int) returns uuid language sql immutable as $$ select ('39390000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid $$;
create function _as(n int) returns void language sql as $$ select set_config('request.jwt.claims', json_build_object('sub', _u(n), 'role', 'authenticated')::text, true) $$;
grant execute on function _u(int), _as(int) to authenticated, service_role;

insert into auth.users(id, instance_id, aud, role, email)
select _u(n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'i' || n || '@interim.test' from generate_series(1, 7) n;
update profiles set role = 'super_admin', status = 'active', first_name = 'Ada', last_name = 'Admin' where id = _u(1);
update profiles set role = 'super_admin', status = 'deactivated', first_name = 'Old', last_name = 'Admin' where id = _u(2);
update profiles set role = 'founder', status = 'active', first_name = 'Fay', last_name = 'Founder' where id = _u(3);
update profiles set role = 'co_founder', status = 'active', first_name = 'Cal', last_name = 'Cofounder' where id = _u(4);
update profiles set role = 'programme_director', status = 'active', first_name = 'Dee', last_name = 'Director' where id = _u(5);
update profiles set role = 'participant', status = 'active', first_name = 'Lia', last_name = 'Learner' where id = _u(6);
update profiles set role = 'super_admin', status = 'active', first_name = 'Ben', last_name = 'Second' where id = _u(7);
insert into participants(id, profile_id, participant_no) values ('39391111-0000-0000-0000-000000000006', _u(6), 'IN-1');
insert into safeguarding_records(id, summary, severity, urgency) values ('3939cccc-0000-0000-0000-000000000001', 'Urgent concern raised before anyone was appointed', 'high', 'urgent');

-- ---------- before any appointment: interim access for active Super Administrators only ----------
select is((select count(*)::int from safeguarding_officers), 0, 'nobody is appointed at the start');
select is((select array_agg(x order by x) from sg_officer_ids() x), array[_u(1), _u(7)], 'alerts go to the active Super Administrators (not the deactivated one, not Founder/Co-Founder)');
select ok((select count(*) from notifications where user_id = _u(1) and kind = 'safeguarding') >= 1, 'the Super Administrator is alerted about an URGENT concern (urgent and overdue alerts follow sg_officer_ids)');
set local role authenticated;
select _as(1);
select is(sg_my_position(), 'interim', 'an active Super Administrator holds interim access');
select ok(is_safeguarding_officer(), 'and is treated as a safeguarding officer');
select is((select count(*)::int from safeguarding_records), 1, 'the Super Administrator can read the record');
select lives_ok($$insert into safeguarding_actions(record_id, action, note) values ('3939cccc-0000-0000-0000-000000000001', 'note', 'Called the facilitator; facts recorded.')$$,
  'and can add a note to it');
select _as(7);
select is(sg_my_position(), 'interim', 'every active Super Administrator holds it');
select _as(3);
select is(sg_my_position(), null, 'the Founder does not');
select is((select count(*)::int from safeguarding_records), 0, 'and cannot read records');
select _as(4);
select is((select count(*)::int from safeguarding_records), 0, 'neither can the Co-Founder');
select _as(5);
select is((select count(*)::int from safeguarding_records), 0, 'nor the programme director');
select _as(2);
select is(sg_my_position(), null, 'a deactivated Super Administrator holds nothing');
select _as(6);
select throws_ok($$select connect_start_safeguarding()$$, null, 'The safeguarding team has not been set up yet. Please speak to your facilitator or contact DIRA Foundation directly',
  'learners still cannot start a safeguarding conversation before an appointment (unchanged)');

-- ---------- a Lead is appointed: interim access ends at once ----------
select _as(3);
select lives_ok($$select sg_appoint('lead', _u(5), 'Board resolution: Safeguarding Lead appointed')$$, 'the Founder appoints the programme director as Lead');
select _as(1);
select is(sg_my_position(), null, 'interim access ends for the Super Administrator');
select is((select count(*)::int from safeguarding_records), 0, 'who can no longer read records');
select _as(5);
select is(sg_my_position(), 'lead', 'the Lead holds the position');
select is((select count(*)::int from safeguarding_records), 1, 'and reads the record');
reset role;
select is((select array_agg(x) from sg_officer_ids() x), array[_u(5)], 'alerts now go to the Lead only');

-- ---------- nobody active is left: interim access resumes ----------
select set_config('request.jwt.claims', '', true);   -- administrative changes below run without a user identity
update profiles set status = 'deactivated' where id = _u(5);
set local role authenticated;
select _as(1);
select is(sg_my_position(), 'interim', 'when the only officer is deactivated, interim access resumes');
reset role;
select set_config('request.jwt.claims', '', true);
update profiles set status = 'active' where id = _u(5);
update safeguarding_officers set unavailable_until = now() + interval '7 days', unavailable_note = 'On leave' where profile_id = _u(5);
set local role authenticated;
select _as(1);
select is(sg_my_position(), null, 'an appointed officer who is only unavailable still counts as appointed');
reset role;
select ok(not has_function_privilege('anon', 'public.sg_my_position()', 'execute'), 'signed-out visitors cannot ask for a position');
select ok(not has_function_privilege('authenticated', 'public.sg_officer_ids()', 'execute'), 'signed-in users cannot list who receives alerts');

select * from finish();
rollback;
