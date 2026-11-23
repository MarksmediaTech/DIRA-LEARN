set search_path = extensions;
-- Minimal pgTAP-compatible functions (SECURITY INVOKER, like real pgTAP) for the calls DIRA LEARN's tests use:
-- plan, ok, is, isnt, lives_ok, throws_ok (2/3/4 args), finish. State lives in transaction-local settings,
-- so it works after `set local role authenticated`.
create or replace function _tap_next() returns int language plpgsql as $$
declare n int := coalesce(nullif(current_setting('tap.n', true), ''), '0')::int + 1;
begin perform set_config('tap.n', n::text, true); return n; end $$;
create or replace function _tap_fail() returns void language plpgsql as $$
begin perform set_config('tap.failed', (coalesce(nullif(current_setting('tap.failed', true), ''), '0')::int + 1)::text, true);
      perform set_config('tap.failed_list', coalesce(current_setting('tap.failed_list', true), '') || current_setting('tap.n', true) || ' ', true); end $$;
create or replace function plan(int) returns text language plpgsql as $$
begin perform set_config('tap.plan', $1::text, true); perform set_config('tap.n', '0', true); perform set_config('tap.failed', '0', true);
      perform set_config('tap.failed_list', '', true); return '1..' || $1; end $$;
create or replace function ok(boolean, text default '') returns text language plpgsql as $$
declare n int := _tap_next();
begin if $1 is true then return 'ok ' || n || ' - ' || $2; end if; perform _tap_fail(); return 'not ok ' || n || ' - ' || $2; end $$;
create or replace function is(anyelement, anyelement, text default '') returns text language plpgsql as $$
declare n int := _tap_next();
begin if $1 is not distinct from $2 then return 'ok ' || n || ' - ' || $3; end if;
  perform _tap_fail(); return 'not ok ' || n || ' - ' || $3 || E'\n#   have: ' || coalesce($1::text, 'NULL') || E'\n#   want: ' || coalesce($2::text, 'NULL'); end $$;
create or replace function isnt(anyelement, anyelement, text default '') returns text language plpgsql as $$
declare n int := _tap_next();
begin if $1 is distinct from $2 then return 'ok ' || n || ' - ' || $3; end if;
  perform _tap_fail(); return 'not ok ' || n || ' - ' || $3 || E'\n#   both: ' || coalesce($1::text, 'NULL'); end $$;
create or replace function lives_ok(text, text default '') returns text language plpgsql as $$
declare n int; err text; st text;
begin
  begin execute $1; exception when others then get stacked diagnostics err = message_text, st = returned_sqlstate; end;
  n := _tap_next();
  if err is null then return 'ok ' || n || ' - ' || $2; end if;
  perform _tap_fail(); return 'not ok ' || n || ' - ' || $2 || E'\n#   died: ' || st || ': ' || err;
end $$;
create or replace function throws_ok(text, text, text, text) returns text language plpgsql as $$
declare n int; err text; st text;
begin
  begin execute $1; exception when others then get stacked diagnostics err = message_text, st = returned_sqlstate; end;
  n := _tap_next();
  if err is null then perform _tap_fail(); return 'not ok ' || n || ' - ' || coalesce($4, '') || E'\n#   no exception thrown'; end if;
  if ($2 is null or $2 = st) and ($3 is null or $3 = err) then return 'ok ' || n || ' - ' || coalesce($4, ''); end if;
  perform _tap_fail();
  return 'not ok ' || n || ' - ' || coalesce($4, '') || E'\n#   caught: ' || st || ': ' || err || E'\n#   wanted: ' || coalesce($2, '*') || ': ' || coalesce($3, '*');
end $$;
create or replace function throws_ok(text, text, text) returns text language sql as $$ select throws_ok($1, null, $2, $3) $$;
create or replace function throws_ok(text, text) returns text language sql as $$
  select case when $2 ~ '^[0-9A-Z]{5}$' then throws_ok($1, $2, null, null) else throws_ok($1, null, $2, null) end $$;
create or replace function throws_ok(text) returns text language sql as $$ select throws_ok($1, null, null, null) $$;
create or replace function finish() returns setof text language plpgsql as $$
declare p int := nullif(current_setting('tap.plan', true), '')::int; n int := coalesce(nullif(current_setting('tap.n', true), ''), '0')::int;
        f int := coalesce(nullif(current_setting('tap.failed', true), ''), '0')::int;
begin
  if p is not null and p <> n then return next '# Looks like you planned ' || p || ' tests but ran ' || n; end if;
  if f > 0 then return next '# FAILED ' || f || ' of ' || n || ': ' || current_setting('tap.failed_list', true); else return next '# all ' || n || ' passed'; end if;
end $$;
grant execute on all functions in schema extensions to anon, authenticated, service_role;
