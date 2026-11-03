begin;

create table public.zsm_live_frames (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  room_id uuid not null unique default gen_random_uuid(),
  frame jsonb not null check (
    jsonb_typeof(frame) = 'object'
    and frame @> '{"version":1}'
    and octet_length(frame::text) <= 12000
  ),
  updated_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default statement_timestamp() + interval '12 hours'
);

alter table public.zsm_live_frames enable row level security;

revoke all on table public.zsm_live_frames from public, anon, authenticated;
grant select (room_id, frame, updated_at, expires_at) on public.zsm_live_frames to anon;
grant select, delete on public.zsm_live_frames to authenticated;
grant insert (owner_id, frame) on public.zsm_live_frames to authenticated;
grant update (frame, updated_at, expires_at) on public.zsm_live_frames to authenticated;

create policy zsm_live_frames_owner on public.zsm_live_frames
  for all to authenticated
  using (
    owner_id = (select auth.uid())
    and (select zsm_private.session_is_active())
    and exists (
      select 1 from public.zsm_profiles
      where id = (select auth.uid()) and status = 'active'
    )
  )
  with check (
    owner_id = (select auth.uid())
    and (select zsm_private.session_is_active())
    and expires_at <= statement_timestamp() + interval '12 hours'
    and exists (
      select 1 from public.zsm_profiles
      where id = (select auth.uid()) and status = 'active'
    )
  );

create policy zsm_live_frames_link on public.zsm_live_frames
  for select to anon
  using (
    room_id = nullif((select current_setting('zsm.live_room', true)), '')::uuid
    and expires_at > statement_timestamp()
  );

-- Both functions run with the caller's grants and RLS policies.
create function public.zsm_publish_live_frame(p_frame jsonb)
returns table (room_id uuid, updated_at timestamptz, expires_at timestamptz)
language sql
security invoker
set search_path = ''
as $$
  insert into public.zsm_live_frames as live (owner_id, frame)
  values ((select auth.uid()), p_frame)
  on conflict (owner_id) do update
    set frame = excluded.frame,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at
  returning live.room_id, live.updated_at, live.expires_at;
$$;

create function public.zsm_read_live_frame(p_room uuid)
returns table (frame jsonb, expires_at timestamptz)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Transaction-local. A direct REST table query carries no capability.
  perform set_config('zsm.live_room', coalesce(p_room::text, ''), true);
  return query
    select live.frame, live.expires_at
    from public.zsm_live_frames live
    where live.room_id = p_room;
end;
$$;

revoke execute on function public.zsm_publish_live_frame(jsonb) from public, anon, authenticated;
grant execute on function public.zsm_publish_live_frame(jsonb) to authenticated;
revoke execute on function public.zsm_read_live_frame(uuid) from public, anon, authenticated;
grant execute on function public.zsm_read_live_frame(uuid) to anon;

commit;
