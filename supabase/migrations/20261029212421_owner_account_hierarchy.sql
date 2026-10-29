-- Pin ownership to the verified Auth user ID; email or user_metadata cannot grant ownership.
do $$
begin
  if not exists (
    select 1 from public.zsm_profiles p join auth.users u on u.id=p.id
    where p.id='e23ae168-d8a1-430d-ba17-59b3cb5949f5'::uuid and p.role='admin' and p.status='active'
  ) then raise exception 'OWNER_ACCOUNT_NOT_READY'; end if;
end;
$$;

create or replace function zsm_private.admin_update_account(
  p_actor uuid, p_target uuid, p_role text, p_status text, p_display_name text
)
returns public.zsm_profiles
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_owner constant uuid := 'e23ae168-d8a1-430d-ba17-59b3cb5949f5';
  v_target public.zsm_profiles;
  v_actor public.zsm_profiles;
begin
  if (select auth.uid()) is null or p_actor is distinct from (select auth.uid())
     or not (select zsm_private.session_is_active()) then
    raise exception 'AUTH_REQUIRED';
  end if;
  lock table public.zsm_profiles in share row exclusive mode;
  select * into v_actor from public.zsm_profiles where id=p_actor;
  if v_actor.id is null or v_actor.role <> 'admin' or v_actor.status <> 'active' then
    raise exception 'ADMIN_REQUIRED';
  end if;
  if p_role is null or p_role not in ('admin','member')
     or p_status is null or p_status not in ('active','blocked')
     or p_display_name is null or char_length(p_display_name)>80 then
    raise exception 'INVALID_INPUT';
  end if;
  select * into v_target from public.zsm_profiles where id=p_target;
  if v_target.id is null then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if p_target=v_owner and
     (p_actor<>v_owner or p_role<>'admin' or p_status<>'active') then
    raise exception 'OWNER_PROTECTED';
  end if;
  if p_actor<>v_owner then
    if p_role is distinct from v_target.role then raise exception 'OWNER_REQUIRED'; end if;
    if v_target.role='admin' and p_target<>p_actor then raise exception 'ADMIN_PROTECTED'; end if;
  end if;
  if p_actor=p_target and (p_role<>'admin' or p_status<>'active') then
    raise exception 'SELF_PROTECTED';
  end if;
  if v_target.role='admin' and v_target.status='active'
    and (p_role<>'admin' or p_status<>'active')
    and (select count(*) from public.zsm_profiles where role='admin' and status='active')<=1 then
    raise exception 'LAST_ADMIN';
  end if;
  update public.zsm_profiles set role=p_role,status=p_status,
    display_name=p_display_name,updated_at=now()
  where id=p_target returning * into v_target;
  if p_status='blocked' then delete from auth.sessions where user_id=p_target; end if;
  return v_target;
end;
$function$;

-- Keep the existing authenticated RPC boundary and session validation.
revoke all on function zsm_private.admin_update_account(uuid,uuid,text,text,text) from public,anon;
grant execute on function zsm_private.admin_update_account(uuid,uuid,text,text,text) to authenticated;

-- Also protect the owner against accidental direct writes and cascading deletion.
create or replace function zsm_private.protect_owner_account()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if old.id='e23ae168-d8a1-430d-ba17-59b3cb5949f5'::uuid then
    if TG_OP='DELETE' then raise exception 'OWNER_PROTECTED'; end if;
    if new.id is distinct from old.id or new.role is distinct from 'admin'
       or new.status is distinct from 'active'
       or ((select auth.uid()) is not null and (select auth.uid())<>old.id) then
      raise exception 'OWNER_PROTECTED';
    end if;
  end if;
  return new;
end;
$function$;
revoke all on function zsm_private.protect_owner_account() from public,anon,authenticated;
drop trigger if exists zsm_protect_owner_account on public.zsm_profiles;
create trigger zsm_protect_owner_account
before update or delete on public.zsm_profiles
for each row execute function zsm_private.protect_owner_account();
