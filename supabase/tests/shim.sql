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
