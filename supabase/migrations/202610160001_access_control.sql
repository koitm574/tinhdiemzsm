-- Run once in the Supabase SQL Editor, or apply with `supabase db push`.
begin;

create schema if not exists zsm_private;
revoke all on schema zsm_private from public, anon;
grant usage on schema zsm_private to authenticated;

create table public.zsm_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null check (char_length(display_name) between 1 and 80),
  role text not null default 'member' check (role in ('admin', 'member')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz
);

create table public.zsm_access_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references public.zsm_profiles(id) on delete set null,
  subject_id uuid references public.zsm_profiles(id) on delete set null,
  action text not null check (action in ('registered', 'status_changed')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index zsm_profiles_created_idx on public.zsm_profiles (created_at desc, id);
create index zsm_access_audit_created_idx on public.zsm_access_audit (created_at desc);

-- No profile field supplied by the browser can grant approval or admin rights.
create function zsm_private.on_auth_user_created()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.zsm_profiles (id, email, display_name)
  values (new.id, coalesce(new.email, ''), coalesce(
    nullif(left(btrim(new.raw_user_meta_data ->> 'display_name'), 80), ''),
    nullif(left(split_part(coalesce(new.email, ''), '@', 1), 80), ''), 'Thành viên'));
  insert into public.zsm_access_audit (subject_id, action)
  values (new.id, 'registered');
  return new;
end;
$$;
create trigger zsm_auth_user_created after insert on auth.users
for each row execute function zsm_private.on_auth_user_created();

-- Keep the contact email in sync with Auth, including confirmed email changes.
create function zsm_private.on_auth_email_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.zsm_profiles set email = coalesce(new.email, ''), updated_at = now()
  where id = new.id;
  return new;
end;
$$;
create trigger zsm_auth_email_changed after update of email on auth.users
for each row when (old.email is distinct from new.email)
execute function zsm_private.on_auth_email_changed();

-- Existing Auth accounts also start as pending. Bootstrap the owner explicitly.
insert into public.zsm_profiles (id, email, display_name)
select id, coalesce(email, ''), coalesce(
  nullif(left(btrim(raw_user_meta_data ->> 'display_name'), 80), ''),
  nullif(left(split_part(coalesce(email, ''), '@', 1), 80), ''), 'Thành viên')
from auth.users on conflict (id) do nothing;

create function zsm_private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.zsm_profiles
    where id = (select auth.uid()) and role = 'admin' and status = 'approved');
$$;

alter table public.zsm_profiles enable row level security;
alter table public.zsm_access_audit enable row level security;
revoke all on public.zsm_profiles, public.zsm_access_audit from public, anon, authenticated;
grant select on public.zsm_profiles, public.zsm_access_audit to authenticated;

create policy zsm_profile_read on public.zsm_profiles for select to authenticated
using (id = (select auth.uid()) or (select zsm_private.is_admin()));
create policy zsm_audit_read on public.zsm_access_audit for select to authenticated
using ((select zsm_private.is_admin()));

-- The JWT identifies the caller; status/role always come from the current DB row.
-- This denies a blocked administrator immediately even with an unexpired JWT.
create function public.zsm_get_access()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result public.zsm_profiles;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED' using errcode = '42501'; end if;
  update public.zsm_profiles set last_seen_at = now()
  where id = auth.uid() and (last_seen_at is null or last_seen_at < now() - interval '1 minute');
  select * into result from public.zsm_profiles where id = auth.uid();
  if not found then raise exception 'PROFILE_NOT_FOUND' using errcode = '42501'; end if;
  return to_jsonb(result);
end;
$$;

create function public.zsm_set_member_status(p_user_id uuid, p_status text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor public.zsm_profiles; target public.zsm_profiles;
begin
  -- Lock the caller while authorizing, so concurrent revocation cannot be bypassed.
  select * into actor from public.zsm_profiles where id = auth.uid() for update;
  if actor.id is null or actor.role <> 'admin' or actor.status <> 'approved' then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('pending', 'approved', 'blocked') then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end if;
  select * into target from public.zsm_profiles where id = p_user_id for update;
  if not found then raise exception 'USER_NOT_FOUND' using errcode = '22023'; end if;
  if target.role = 'admin' or target.id = actor.id then
    raise exception 'ADMIN_ACCOUNT_PROTECTED' using errcode = '42501';
  end if;
  if target.status = p_status then return to_jsonb(target); end if;
  insert into public.zsm_access_audit (actor_id, subject_id, action, details)
  values (actor.id, target.id, 'status_changed', jsonb_build_object(
    'from', target.status, 'to', p_status, 'email', target.email));
  update public.zsm_profiles set status = p_status, updated_at = now()
  where id = p_user_id returning * into target;
  return to_jsonb(target);
end;
$$;

-- Explicit execution grants: functions default to PUBLIC execute in PostgreSQL.
revoke all on all functions in schema zsm_private from public, anon, authenticated;
grant execute on function zsm_private.is_admin() to authenticated;
revoke all on function public.zsm_get_access() from public, anon, authenticated;
revoke all on function public.zsm_set_member_status(uuid, text) from public, anon, authenticated;
grant execute on function public.zsm_get_access() to authenticated;
grant execute on function public.zsm_set_member_status(uuid, text) to authenticated;

commit;
