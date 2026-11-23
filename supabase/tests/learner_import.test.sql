-- pgTAP tests for migration 12. NOT yet executed.
begin;
select plan(5);
insert into auth.users(id, instance_id, aud, role, email) values
  ('dedededa-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','coord@m12.local'),
  ('dedededa-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','trainer@m12.local');
update profiles set role='programme_coordinator', status='active' where id = 'dedededa-0000-0000-0000-000000000001';
update profiles set role='trainer', status='active' where id = 'dedededa-0000-0000-0000-000000000002';
insert into import_batches(id, file_name, total, invited) values ('dededede-0000-0000-0000-000000000001','learners.csv',1,1);
insert into import_rows(batch_id, row_no, email, outcome) values ('dededede-0000-0000-0000-000000000001', 2, 'a@b.org', 'invited');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"dedededa-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from import_batches), 1, 'programme management can read import batches');
select is((select count(*)::int from import_rows), 1, 'programme management can read import rows');
select throws_ok($$insert into import_batches(total) values (1)$$, '42501', null, 'the browser cannot write import batches');
select set_config('request.jwt.claims', '{"sub":"dedededa-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from import_batches), 0, 'a trainer cannot read import batches');
select is((select count(*)::int from import_rows), 0, 'a trainer cannot read the imported names and emails');
select * from finish();
rollback;
