-- Untrusted runtime roles must not create public objects or shadow definer tables
-- with temporary tables. Preserve functions and their existing authorization logic.
revoke create on schema public from public;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as identity from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f' and p.prosecdef
  loop
    execute format('alter function %s set search_path = pg_catalog, public, pg_temp',f.identity);
  end loop;
end; $$;
