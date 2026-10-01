-- Ledger database. Run this whole file once:
-- Supabase dashboard -> SQL Editor -> New query -> paste -> Run

-- ============ TABLES ============
create table public.tabs (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 40),
  goal       numeric(12,2) not null default 0 check (goal >= 0),
  currency   text not null default 'USD' check (char_length(currency) = 3),
  created_at timestamptz not null default now()
);

create table public.tab_members (
  tab_id  uuid not null references public.tabs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role    text not null check (role in ('viewer','editor')),
  primary key (tab_id, user_id)
);
create index tab_members_user on public.tab_members (user_id);

create table public.entries (
  id         uuid primary key default gen_random_uuid(),
  tab_id     uuid not null references public.tabs(id) on delete cascade,
  user_id    uuid default auth.uid() references auth.users(id) on delete set null,
  type       text not null check (type in ('income','expense')),
  amount     numeric(12,2) not null check (amount > 0),
  category   text not null check (char_length(category) <= 40),
  note       text not null default '' check (char_length(note) <= 120),
  date       date not null default current_date,
  created_at timestamptz not null default now()
);
create index entries_tab_date on public.entries (tab_id, date);

-- counts AI requests so nobody can use up your free AI quota
create table public.ai_calls (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index ai_calls_user_time on public.ai_calls (user_id, created_at);

-- ============ HELPER FUNCTIONS ============
create or replace function public.is_tab_owner(p_tab uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.tabs where id = p_tab and owner_id = auth.uid());
$$;

create or replace function public.tab_role(p_tab uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.tabs where id = p_tab and owner_id = auth.uid()) then 'owner'
    else (select role from public.tab_members where tab_id = p_tab and user_id = auth.uid())
  end;
$$;

-- the owner shares a tab with someone who already has an account
create or replace function public.share_tab(p_tab uuid, p_email text, p_role text default 'editor')
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_user uuid;
begin
  if not public.is_tab_owner(p_tab) then
    raise exception 'Only the owner can share this tab';
  end if;
  if p_role not in ('viewer','editor') then
    raise exception 'Role must be viewer or editor';
  end if;
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'No account with that email yet. Ask them to sign up first.';
  end if;
  if v_user = auth.uid() then
    raise exception 'You already own this tab';
  end if;
  insert into public.tab_members (tab_id, user_id, role) values (p_tab, v_user, p_role)
  on conflict (tab_id, user_id) do update set role = excluded.role;
end $$;

-- the owner sees who has access
create or replace function public.tab_members_list(p_tab uuid)
returns table (user_id uuid, email text, role text)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not public.is_tab_owner(p_tab) then
    raise exception 'Only the owner can see members';
  end if;
  return query
    select m.user_id, u.email::text, m.role
    from public.tab_members m join auth.users u on u.id = m.user_id
    where m.tab_id = p_tab order by u.email;
end $$;

revoke all on function public.is_tab_owner(uuid)          from public, anon;
revoke all on function public.tab_role(uuid)              from public, anon;
revoke all on function public.share_tab(uuid, text, text) from public, anon;
revoke all on function public.tab_members_list(uuid)      from public, anon;
grant execute on function public.is_tab_owner(uuid)          to authenticated;
grant execute on function public.tab_role(uuid)              to authenticated;
grant execute on function public.share_tab(uuid, text, text) to authenticated;
grant execute on function public.tab_members_list(uuid)      to authenticated;

-- ============ ROW LEVEL SECURITY ============
alter table public.tabs        enable row level security;
alter table public.tab_members enable row level security;
alter table public.entries     enable row level security;
alter table public.ai_calls    enable row level security;

-- tabs: you see tabs you own or that were shared with you; only the owner changes them
create policy tabs_select on public.tabs for select to authenticated
  using (owner_id = auth.uid() or public.tab_role(id) is not null);
create policy tabs_insert on public.tabs for insert to authenticated
  with check (owner_id = auth.uid());
create policy tabs_update on public.tabs for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy tabs_delete on public.tabs for delete to authenticated
  using (owner_id = auth.uid());

-- members: you see your own membership, the owner sees everyone; adding goes through share_tab()
create policy members_select on public.tab_members for select to authenticated
  using (user_id = auth.uid() or public.is_tab_owner(tab_id));
create policy members_delete on public.tab_members for delete to authenticated
  using (user_id = auth.uid() or public.is_tab_owner(tab_id));

-- entries: viewers read, editors and owners write
create policy entries_select on public.entries for select to authenticated
  using (public.tab_role(tab_id) is not null);
create policy entries_insert on public.entries for insert to authenticated
  with check (public.tab_role(tab_id) in ('owner','editor') and user_id = auth.uid());
create policy entries_update on public.entries for update to authenticated
  using (public.tab_role(tab_id) in ('owner','editor'))
  with check (public.tab_role(tab_id) in ('owner','editor'));
create policy entries_delete on public.entries for delete to authenticated
  using (public.tab_role(tab_id) in ('owner','editor'));

-- ai_calls: each user sees and adds only their own rows
create policy ai_select on public.ai_calls for select to authenticated using (user_id = auth.uid());
create policy ai_insert on public.ai_calls for insert to authenticated with check (user_id = auth.uid());

-- ============ LIVE UPDATES (dad adds something, you see it instantly) ============
alter table public.entries replica identity full;
alter publication supabase_realtime add table public.entries;
