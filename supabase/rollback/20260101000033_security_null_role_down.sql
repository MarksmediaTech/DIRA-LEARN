-- Rollback for 20260101000033_security_null_role.sql. ONE transaction. WARNING: this puts the security gap back
-- (signed-out visitors could approve curriculum sessions). Use only to recover from an unexpected problem, then fix forward.
begin;

do $$
declare r record; g json; a record;
begin
  -- function definitions exactly as before
  for r in select name, data from security_fix_33_backup where kind = 'function' loop
    execute r.data;
  end loop;
  -- execute rights exactly as before, in their original order
  for r in select name, data from security_fix_33_backup where kind = 'grant' loop
    g := r.data::json;
    execute format('revoke execute on function %s from public, anon, authenticated, service_role', r.name);
    for a in select x.grantee from aclexplode((g ->> 'acl')::aclitem[]) with ordinality as x(grantor, grantee, privilege_type, is_grantable, n)
              where x.privilege_type = 'EXECUTE' and x.grantee not in (select oid from pg_roles where rolname = current_user) order by x.n loop
      execute format('grant execute on function %s to %s', r.name, case when a.grantee = 0 then 'public' else quote_ident((select rolname from pg_roles where oid = a.grantee)) end);
    end loop;
  end loop;
end $$;

drop table security_fix_33_backup;

commit;
