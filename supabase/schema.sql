-- Gate88Redux online multiplayer setup.
-- Run this file in the Supabase SQL editor for a project with Anonymous Auth enabled.

create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.lobbies (
  id uuid primary key default gen_random_uuid(),
  room_code text unique not null,
  host_name text not null,
  host_user_id uuid not null default auth.uid(),
  host_slot int not null default 0,
  player_count int not null default 1,
  max_players int not null default 6,
  match_started boolean not null default false,
  locked boolean not null default false,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lobbies_room_code_format check (room_code ~ '^[A-Z2-9]{2,12}$'),
  constraint lobbies_player_count_nonnegative check (player_count >= 0),
  constraint lobbies_max_players_range check (max_players between 1 and 8),
  constraint lobbies_player_count_capacity check (player_count <= max_players),
  constraint lobbies_host_slot_range check (host_slot between 0 and 7)
);

create table if not exists public.lobby_participants (
  lobby_id uuid not null references public.lobbies(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  slot int not null,
  joined_at timestamptz not null default now(),
  primary key (lobby_id, user_id),
  unique (lobby_id, slot),
  constraint lobby_participants_slot_range check (slot between 0 and 7)
);

create table if not exists public.signals (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid not null references public.lobbies(id) on delete cascade,
  from_slot int not null,
  to_slot int not null,
  type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  constraint signals_from_slot_range check (from_slot between 0 and 7),
  constraint signals_to_slot_range check (to_slot between -1 and 7),
  constraint signals_type_check check (type in ('want_connect', 'offer', 'answer', 'ice', 'match_start')),
  constraint signals_payload_size_check check (octet_length(payload::text) <= 65536)
);

create index if not exists lobbies_match_started_updated_idx
  on public.lobbies (match_started, updated_at desc);
create index if not exists lobbies_match_started_created_idx
  on public.lobbies (match_started, created_at desc);
create index if not exists lobbies_room_code_idx
  on public.lobbies (room_code);
create index if not exists lobbies_expires_at_idx
  on public.lobbies (expires_at);

create index if not exists lobby_participants_user_idx
  on public.lobby_participants (user_id, lobby_id);

create index if not exists signals_lobby_to_created_idx
  on public.signals (lobby_id, to_slot, created_at);
create index if not exists signals_lobby_from_created_idx
  on public.signals (lobby_id, from_slot, created_at);
create index if not exists signals_created_at_idx
  on public.signals (created_at);

create or replace function private.set_lobby_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_lobbies_updated_at on public.lobbies;
create trigger trg_lobbies_updated_at
before update on public.lobbies
for each row
execute function private.set_lobby_updated_at();

create or replace function private.add_host_as_participant()
returns trigger
language plpgsql
security definer
set search_path = public, private
as $$
begin
  insert into public.lobby_participants (lobby_id, user_id, slot)
  values (new.id, new.host_user_id, new.host_slot)
  on conflict (lobby_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_lobbies_add_host_participant on public.lobbies;
create trigger trg_lobbies_add_host_participant
after insert on public.lobbies
for each row
execute function private.add_host_as_participant();

create or replace function public.join_lobby_by_code(p_room_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_lobby public.lobbies;
  v_slot int;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
    into v_lobby
    from public.lobbies
    where room_code = upper(trim(p_room_code))
      and match_started = false
      and locked = false
      and updated_at > now() - interval '90 seconds'
      and (expires_at is null or expires_at > now())
    for update;

  if not found then
    raise exception 'Lobby not found or no longer joinable';
  end if;

  select slot
    into v_slot
    from public.lobby_participants
    where lobby_id = v_lobby.id
      and user_id = auth.uid();

  if found then
    return jsonb_build_object(
      'lobby', to_jsonb(v_lobby),
      'assigned_slot', v_slot
    );
  end if;

  if v_lobby.player_count >= v_lobby.max_players then
    raise exception 'Lobby is full';
  end if;

  select candidate
    into v_slot
    from generate_series(0, v_lobby.max_players - 1) as candidate
    where not exists (
      select 1
      from public.lobby_participants p
      where p.lobby_id = v_lobby.id
        and p.slot = candidate
    )
    order by candidate
    limit 1;

  if v_slot is null then
    raise exception 'No open lobby slot';
  end if;

  insert into public.lobby_participants (lobby_id, user_id, slot)
  values (v_lobby.id, auth.uid(), v_slot);

  update public.lobbies
    set player_count = player_count + 1
    where id = v_lobby.id
    returning * into v_lobby;

  return jsonb_build_object(
    'lobby', to_jsonb(v_lobby),
    'assigned_slot', v_slot
  );
end;
$$;

create or replace function private.clean_stale_lobbies()
returns int
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.lobbies
    where match_started = false
      and (
        updated_at < now() - interval '90 seconds'
        or (expires_at is not null and expires_at < now())
      )
    returning 1
  )
  select count(*)::int from deleted;
$$;

create or replace function private.clean_old_signals()
returns int
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.signals
    where created_at < now() - interval '5 minutes'
    returning 1
  )
  select count(*)::int from deleted;
$$;

create or replace function public.clean_stale_lobbies()
returns int
language sql
security definer
set search_path = public, private
as $$
  select private.clean_stale_lobbies();
$$;

create or replace function public.clean_old_signals()
returns int
language sql
security definer
set search_path = public, private
as $$
  select private.clean_old_signals();
$$;

alter table public.lobbies enable row level security;
alter table public.lobby_participants enable row level security;
alter table public.signals enable row level security;

drop policy if exists "authenticated can read visible lobbies" on public.lobbies;
create policy "authenticated can read visible lobbies"
  on public.lobbies
  for select
  to authenticated
  using (
    match_started = false
    and locked = false
    and updated_at > now() - interval '90 seconds'
    and (expires_at is null or expires_at > now())
  );

drop policy if exists "hosts can create lobbies" on public.lobbies;
create policy "hosts can create lobbies"
  on public.lobbies
  for insert
  to authenticated
  with check (host_user_id = auth.uid());

drop policy if exists "hosts can update own lobbies" on public.lobbies;
create policy "hosts can update own lobbies"
  on public.lobbies
  for update
  to authenticated
  using (host_user_id = auth.uid())
  with check (host_user_id = auth.uid());

drop policy if exists "hosts can delete own lobbies" on public.lobbies;
create policy "hosts can delete own lobbies"
  on public.lobbies
  for delete
  to authenticated
  using (host_user_id = auth.uid());

drop policy if exists "participants can read own participation" on public.lobby_participants;
create policy "participants can read own participation"
  on public.lobby_participants
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "participants can read addressed signals" on public.signals;
create policy "participants can read addressed signals"
  on public.signals
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.lobby_participants p
      where p.lobby_id = signals.lobby_id
        and p.user_id = auth.uid()
        and (signals.to_slot = -1 or signals.to_slot = p.slot or signals.from_slot = p.slot)
    )
  );

drop policy if exists "participants can insert own slot signals" on public.signals;
create policy "participants can insert own slot signals"
  on public.signals
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.lobby_participants p
      where p.lobby_id = signals.lobby_id
        and p.user_id = auth.uid()
        and p.slot = signals.from_slot
    )
  );

drop policy if exists "hosts can delete lobby signals" on public.signals;
create policy "hosts can delete lobby signals"
  on public.signals
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.lobbies l
      where l.id = signals.lobby_id
        and l.host_user_id = auth.uid()
    )
  );

grant usage on schema public to authenticated;
revoke all on schema private from public, anon, authenticated;
grant select, insert, update, delete on public.lobbies to authenticated;
grant select on public.lobby_participants to authenticated;
grant select, insert, delete on public.signals to authenticated;
revoke all on function public.clean_stale_lobbies() from public, anon, authenticated;
revoke all on function public.clean_old_signals() from public, anon, authenticated;
grant execute on function public.join_lobby_by_code(text) to authenticated;
