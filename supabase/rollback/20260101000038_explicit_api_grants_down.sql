-- Rollback of migration 38 (explicit Data API grants). Run in one transaction, then delete version 20260101000038 from
-- supabase_migrations.schema_migrations. Restores the privileges of anon, authenticated, service_role and PUBLIC on every
-- table, view, sequence and function in public EXACTLY as recorded in grants_38_backup before migration 38, then drops
-- the backup table.
-- WARNING: on a project with Supabase's current defaults the recorded state had NO grants for signed-in users, so after
-- this rollback every signed-in request is refused again (the 403 on profiles). Roll back only to restore a backup.

do $$
declare r record;
begin
  if to_regclass('public.grants_38_backup') is null then
    raise exception 'rollback 38: grants_38_backup is missing; nothing was changed';
  end if;

  -- 1. remove every privilege the API roles have now
  execute 'revoke all on all tables in schema public from anon, authenticated, service_role';
  execute 'revoke all on all sequences in schema public from anon, authenticated, service_role';
  execute 'revoke execute on all functions in schema public from public, anon, authenticated, service_role';

  -- 2. re-grant exactly what was recorded (objects that no longer exist are skipped)
  for r in select * from grants_38_backup where object_kind = 'relation' loop
    if to_regclass(r.object_name) is not null then
      execute format('grant %s on %s to %s', r.privilege, r.object_name, case r.grantee when 'PUBLIC' then 'public' else quote_ident(r.grantee) end);
    end if;
  end loop;
  for r in select * from grants_38_backup where object_kind = 'function' loop
    if to_regprocedure(r.object_name) is not null then
      execute format('grant execute on function %s to %s', r.object_name, case r.grantee when 'PUBLIC' then 'public' else quote_ident(r.grantee) end);
    end if;
  end loop;
end $$;

drop table grants_38_backup;
