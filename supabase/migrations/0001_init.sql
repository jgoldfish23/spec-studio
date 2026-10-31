-- Spec Studio initial schema: one row of data per company, readable and writable only by its members.
-- Runs on Supabase as-is: it uses auth.users and auth.uid() (Supabase provides both) and creates
-- neither the auth schema nor the anon/authenticated roles.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.companies (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  default_region text not null default 'utah-north',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table public.memberships (
  user_id    uuid not null references auth.users (id) on delete cascade,
  company_id uuid not null references public.companies (id) on delete cascade,
  role       text not null default 'owner' check (role = 'owner'),
  primary key (user_id, company_id)
);

create table public.deals (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  name           text not null,
  status         text not null default 'analyzing'
                 check (status in ('analyzing', 'bought', 'building', 'listed', 'sold', 'dropped')),
  schema_version int not null default 1,
  inputs         jsonb not null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index deals_company_id_idx on public.deals (company_id);

create table public.comps (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies (id) on delete cascade,
  region     text not null,
  data       jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index comps_company_region_idx on public.comps (company_id, region);

-- company_id null = a global row, shared by every company and read-only for them.
create table public.default_prices (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid references public.companies (id) on delete cascade,
  region           text not null,
  code             text not null,
  variant          text not null,
  tier             text check (tier in ('standard', 'upgraded', 'luxury')),
  unit             text not null,
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  as_of            date not null,
  verified         boolean not null default false,
  source_note      text not null default '',
  unique nulls not distinct (company_id, region, code, variant, tier)
);

create table public.price_book_entries (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  code             text not null,
  variant          text not null,
  tier             text check (tier in ('standard', 'upgraded', 'luxury')),
  unit             text not null,
  unit_price_cents bigint not null check (unit_price_cents >= 0),
  as_of            date not null,
  vendor           text,
  notes            text
);
create index price_book_entries_company_id_idx on public.price_book_entries (company_id);

create table public.market_settings (
  company_id uuid not null references public.companies (id) on delete cascade,
  region     text not null,
  settings   jsonb not null,
  primary key (company_id, region)
);

create table public.company_settings (
  company_id      uuid primary key references public.companies (id) on delete cascade,
  rules           jsonb not null,
  contingency_pct numeric not null
);

-- ---------------------------------------------------------------------------
-- updated_at: one shared function, attached to every table that has the column
-- ---------------------------------------------------------------------------

create function public.set_updated_at() returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger companies_set_updated_at before update on public.companies
  for each row execute function public.set_updated_at();
create trigger deals_set_updated_at before update on public.deals
  for each row execute function public.set_updated_at();
create trigger comps_set_updated_at before update on public.comps
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Membership check used by every policy
-- ---------------------------------------------------------------------------

-- security definer so the lookup is not itself filtered by memberships' row-level security;
-- the pinned search_path stops a caller from shadowing public.memberships.
create function public.is_member(cid uuid) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.memberships m
    where m.company_id = cid
      and m.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.companies          enable row level security;
alter table public.memberships        enable row level security;
alter table public.deals              enable row level security;
alter table public.comps              enable row level security;
alter table public.default_prices     enable row level security;
alter table public.price_book_entries enable row level security;
alter table public.market_settings    enable row level security;
alter table public.company_settings   enable row level security;

-- Read-only for everyone: companies and memberships are created and changed by the service role.
create policy companies_select on public.companies
  for select to authenticated
  using (public.is_member(id));

create policy memberships_select on public.memberships
  for select to authenticated
  using (user_id = auth.uid());

-- Company-owned tables: members may read and write rows of their own company, nothing else.
create policy deals_member on public.deals
  for all to authenticated
  using (public.is_member(company_id))
  with check (public.is_member(company_id));

create policy comps_member on public.comps
  for all to authenticated
  using (public.is_member(company_id))
  with check (public.is_member(company_id));

create policy price_book_entries_member on public.price_book_entries
  for all to authenticated
  using (public.is_member(company_id))
  with check (public.is_member(company_id));

create policy market_settings_member on public.market_settings
  for all to authenticated
  using (public.is_member(company_id))
  with check (public.is_member(company_id));

create policy company_settings_member on public.company_settings
  for all to authenticated
  using (public.is_member(company_id))
  with check (public.is_member(company_id));

-- Default prices: everyone signed in reads the global rows (null company) and their own company's;
-- only a company's own rows can be written.
create policy default_prices_select on public.default_prices
  for select to authenticated
  using (company_id is null or public.is_member(company_id));

create policy default_prices_insert on public.default_prices
  for insert to authenticated
  with check (company_id is not null and public.is_member(company_id));

create policy default_prices_update on public.default_prices
  for update to authenticated
  using (company_id is not null and public.is_member(company_id))
  with check (company_id is not null and public.is_member(company_id));

create policy default_prices_delete on public.default_prices
  for delete to authenticated
  using (company_id is not null and public.is_member(company_id));

-- ---------------------------------------------------------------------------
-- Grants: signed-in users get table access (row-level security narrows it); anon gets nothing.
-- ---------------------------------------------------------------------------

grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- Supabase's default privileges hand anon every new table in public; take that back explicitly.
revoke all on all tables in schema public from anon;
