-- Spec Studio go-live: company sign-up, timestamps on every table, tighter default grants.
-- Runs on Supabase as-is: it relies only on auth.uid() and the anon/authenticated roles, which
-- Supabase provides. Append-only: 0001 is never edited.

-- ---------------------------------------------------------------------------
-- Timestamps on every table
-- ---------------------------------------------------------------------------

-- 0001 stamped companies, deals and comps only. Give the rest the same two columns and trigger, so
-- every table in public can be synced and conflict-checked the same way.
alter table public.memberships        add column created_at timestamptz not null default now(),
                                      add column updated_at timestamptz not null default now();
alter table public.default_prices     add column created_at timestamptz not null default now(),
                                      add column updated_at timestamptz not null default now();
alter table public.price_book_entries add column created_at timestamptz not null default now(),
                                      add column updated_at timestamptz not null default now();
alter table public.market_settings    add column created_at timestamptz not null default now(),
                                      add column updated_at timestamptz not null default now();
alter table public.company_settings   add column created_at timestamptz not null default now(),
                                      add column updated_at timestamptz not null default now();

create trigger memberships_set_updated_at before update on public.memberships
  for each row execute function public.set_updated_at();
create trigger default_prices_set_updated_at before update on public.default_prices
  for each row execute function public.set_updated_at();
create trigger price_book_entries_set_updated_at before update on public.price_book_entries
  for each row execute function public.set_updated_at();
create trigger market_settings_set_updated_at before update on public.market_settings
  for each row execute function public.set_updated_at();
create trigger company_settings_set_updated_at before update on public.company_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Tighter default privileges
-- ---------------------------------------------------------------------------

-- Supabase's default privileges hand anon and authenticated ALL on every table created later in
-- public. 0001 only fixed the tables that existed then; this stops a future table from silently
-- shipping TRUNCATE, TRIGGER and REFERENCES to every signed-in user. New tables get an explicit grant.
alter default privileges in schema public revoke all on tables from anon, authenticated;

-- Postgres lets PUBLIC execute every new function. Functions in public are callable over the API,
-- so a new function must be granted on purpose, never exposed by default.
alter default privileges in schema public revoke execute on functions from public, anon;

-- The trigger function has no business being callable by users; triggers do not need the caller to
-- hold EXECUTE.
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- Take back anything anon already holds on existing functions (is_member was open to PUBLIC).
revoke all on all functions in schema public from anon;

-- ---------------------------------------------------------------------------
-- Membership check, rewritten
-- ---------------------------------------------------------------------------

-- (select auth.uid()) is evaluated once per statement instead of once per row, which matters for the
-- policies that call this on every row. Pinned empty search_path; every name is qualified.
create or replace function public.is_member(cid uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.company_id = cid
      and m.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_member(uuid) from public, anon;
grant execute on function public.is_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Company sign-up
-- ---------------------------------------------------------------------------

-- Users cannot insert companies or memberships under row-level security, so sign-up goes through
-- this function, which runs as its owner and acts only for the caller (auth.uid()).
-- Errors, mapped by the app: SS001 not signed in, SS002 already a member of a company, SS003 bad name.
create function public.create_company(p_name text, p_rules jsonb, p_contingency_pct numeric)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_name text := regexp_replace(coalesce(p_name, ''), '^\s+|\s+$', '', 'g');
  v_id   uuid;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = 'SS001';
  end if;

  if v_name = '' or char_length(v_name) > 120 then
    raise exception 'company name must be 1 to 120 characters' using errcode = 'SS003';
  end if;

  -- Serialise per user so two simultaneous calls cannot both pass the membership check.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  if exists (select 1 from public.memberships m where m.user_id = v_uid) then
    raise exception 'already a member of a company' using errcode = 'SS002';
  end if;

  insert into public.companies (name) values (v_name) returning id into v_id;
  insert into public.memberships (user_id, company_id, role) values (v_uid, v_id, 'owner');
  insert into public.company_settings (company_id, rules, contingency_pct)
    values (v_id, p_rules, p_contingency_pct);

  return v_id;
end;
$$;

revoke all on function public.create_company(text, jsonb, numeric) from public, anon;
grant execute on function public.create_company(text, jsonb, numeric) to authenticated;
