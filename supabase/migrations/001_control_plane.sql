-- SecurityOS hybrid control plane.
-- Camera credentials, raw video, face embeddings, and inference stay on the
-- customer's local agent. Supabase stores accounts, sites, memberships, and
-- registered agent health only.

create extension if not exists pgcrypto;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  platform_role text not null default 'customer'
    check (platform_role in ('owner', 'support', 'customer')),
  stripe_customer_id text unique,
  billing_status text not null default 'incomplete'
    check (billing_status in ('incomplete', 'active', 'past_due', 'canceled')),
  plan text check (plan in ('monthly', 'yearly')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.site_members (
  site_id uuid not null references public.sites(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'member'
    check (role in ('owner', 'admin', 'member', 'viewer')),
  primary key (site_id, user_id)
);

create table public.device_agents (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references public.sites(id) on delete cascade,
  name text not null,
  public_key text not null,
  version text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.sites enable row level security;
alter table public.site_members enable row level security;
alter table public.device_agents enable row level security;

create policy "profile self read"
  on public.profiles for select
  using (id = auth.uid());

create policy "members read their sites"
  on public.sites for select
  using (
    exists (
      select 1 from public.site_members m
      where m.site_id = sites.id and m.user_id = auth.uid()
    )
  );

create policy "members read memberships"
  on public.site_members for select
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.site_members mine
      where mine.site_id = site_members.site_id
        and mine.user_id = auth.uid()
        and mine.role in ('owner', 'admin')
    )
  );

create policy "site admins manage memberships"
  on public.site_members for all
  using (
    exists (
      select 1 from public.site_members mine
      where mine.site_id = site_members.site_id
        and mine.user_id = auth.uid()
        and mine.role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1 from public.site_members mine
      where mine.site_id = site_members.site_id
        and mine.user_id = auth.uid()
        and mine.role in ('owner', 'admin')
    )
  );

create policy "members read site agents"
  on public.device_agents for select
  using (
    exists (
      select 1 from public.site_members m
      where m.site_id = device_agents.site_id and m.user_id = auth.uid()
    )
  );

-- The backend service role creates profiles/sites and updates Stripe state.
-- Do not expose SUPABASE_SERVICE_ROLE_KEY to browsers or local camera agents.
