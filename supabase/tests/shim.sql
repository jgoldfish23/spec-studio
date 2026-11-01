-- Stand-ins for what Supabase provides, so supabase/migrations/*.sql can run on a plain Postgres.
-- Test use only: never apply this to a Supabase project.

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key
);

-- Supabase reads the signed-in user from the request's JWT claims; the tests set the same setting.
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- Roles are cluster-wide, so a second test database finds them already there. Two databases created
-- at the same moment can also race on the role name (unique_violation instead of duplicate_object).
do $$
begin
  begin
    create role anon nologin;
  exception when duplicate_object or unique_violation then
    null;
  end;
  begin
    create role authenticated nologin;
  exception when duplicate_object or unique_violation then
    null;
  end;
end
$$;

-- Policies call auth.uid() as the signed-in role, so both roles must be able to see the auth schema
-- (Supabase grants the same).
grant usage on schema auth to anon, authenticated;

-- Supabase hands anon and authenticated every privilege (TRUNCATE, TRIGGER and REFERENCES included)
-- on each new table in public, for tables created by the role that runs the migrations. Mimic that
-- here; this must run as the same role that later runs the migrations, which is true because the
-- test helpers apply the shim and the migrations on one superuser connection. A migration that only
-- adds grants therefore leaves the extra privileges in place, as it would on Supabase.
alter default privileges in schema public grant all on tables to anon, authenticated;
