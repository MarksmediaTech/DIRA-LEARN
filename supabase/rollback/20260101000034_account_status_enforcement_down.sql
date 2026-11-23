-- Rollback for 20260101000034_account_status_enforcement.sql. ONE transaction.
-- WARNING: this re-opens audit finding H1 (deactivated or reassigned staff keep cohort access) and stops refusing existing
-- sessions of deactivated accounts. Use only to recover from an unexpected problem, then fix forward.
-- Data: account statuses stay as they are. The status-change history table is removed, but every entry was also copied to
-- audit_logs (table account_status_events) when it was written, so the history is not lost.
begin;

do $$
declare r record; previous text;
begin
  -- access helpers exactly as before
  for r in select data from security_fix_34_backup where kind = 'function' loop execute r.data; end loop;

  -- the API pre-request setting as before (another value is restored; none is reset)
  previous := (select data from security_fix_34_backup where kind = 'role_setting' and name = 'authenticator');
  begin
    if previous is null then execute 'alter role authenticator reset pgrst.db_pre_request';
    else execute format('alter role authenticator set pgrst.db_pre_request = %L', split_part(previous, '=', 2)); end if;
    notify pgrst, 'reload config';
  exception when insufficient_privilege then
    raise warning 'Could not reset the API pre-request setting (no permission). Run: alter role authenticator reset pgrst.db_pre_request; notify pgrst, ''reload config'';';
  end;

  -- the active-account rule on every table
  for r in select schemaname, tablename from pg_policies where policyname = 'dira_active_account' loop
    execute format('drop policy dira_active_account on %I.%I', r.schemaname, r.tablename);
  end loop;
end $$;

drop trigger trg_guard_profile_status_change on profiles;
drop function guard_profile_status_change();
drop function admin_set_account_status(uuid, account_status, text);
drop table account_status_events;
drop function guard_account_status_events();
drop function check_request();
drop function account_is_active();
drop table security_fix_34_backup;

commit;
