-- ============================================================
-- Recruitment Tracker — Supabase Schema
-- Paste this entire file into: Supabase > SQL Editor > Run
-- ============================================================


-- ── Profiles (mirrors auth.users, stores role) ──────────────

create table public.profiles (
  id     uuid references auth.users(id) on delete cascade primary key,
  email  text,
  role   text not null default 'brother' check (role in ('admin', 'brother')),
  created_at timestamptz default now()
);
alter table public.profiles enable row level security;

-- Auto-create a profile row whenever a new user signs up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper: is the calling user an admin?
create or replace function public.is_admin()
returns boolean language sql security definer stable as $$
  select exists(
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- RLS: users can read their own profile; admins can read all
create policy "own profile" on public.profiles
  for select using (auth.uid() = id);

create policy "admin sees all profiles" on public.profiles
  for select using (public.is_admin());


-- ── Recruits ────────────────────────────────────────────────

create table public.recruits (
  id    uuid primary key default gen_random_uuid(),
  name  text not null,
  major text,
  created_at timestamptz default now()
);
alter table public.recruits enable row level security;

create policy "authenticated can view recruits" on public.recruits
  for select using (auth.role() = 'authenticated');

create policy "admin manages recruits" on public.recruits
  for all using (public.is_admin());


-- ── Events ──────────────────────────────────────────────────

create table public.events (
  id   uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);
alter table public.events enable row level security;

create policy "authenticated can view events" on public.events
  for select using (auth.role() = 'authenticated');

create policy "admin manages events" on public.events
  for all using (public.is_admin());


-- ── Votes ───────────────────────────────────────────────────
-- user_id stored for dedup / one-vote enforcement only.
-- The UI never shows who voted — only aggregate counts reach brothers.

create table public.votes (
  id          uuid primary key default gen_random_uuid(),
  recruit_id  uuid references public.recruits(id) on delete cascade not null,
  event_id    uuid references public.events(id) on delete cascade not null,
  user_id     uuid references auth.users(id) on delete cascade not null,
  vote        text not null check (vote in ('good', 'bad')),
  created_at  timestamptz default now(),
  unique(recruit_id, event_id, user_id)
);
alter table public.votes enable row level security;

-- Brothers: full control over their own votes
create policy "own votes" on public.votes
  for all using (auth.uid() = user_id);

-- Admin: read all votes
create policy "admin sees all votes" on public.votes
  for select using (public.is_admin());


-- ── Notes (admin only) ──────────────────────────────────────

create table public.notes (
  id          uuid primary key default gen_random_uuid(),
  recruit_id  uuid references public.recruits(id) on delete cascade not null unique,
  content     text,
  updated_at  timestamptz default now()
);
alter table public.notes enable row level security;

create policy "admin manages notes" on public.notes
  for all using (public.is_admin());
