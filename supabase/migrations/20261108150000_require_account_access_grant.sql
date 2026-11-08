create or replace function public.current_user_is_blocked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce((
        select access_row.is_blocked
            or access_row.access_until is null
            or access_row.access_until <= now()
        from public.account_access as access_row
        where access_row.user_id = (select auth.uid())
    ), true);
$$;

revoke all on function public.current_user_is_blocked() from public, anon;
grant execute on function public.current_user_is_blocked() to authenticated;

create or replace function public.create_account_access_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
    insert into public.account_access (user_id, is_blocked, access_until)
    values (new.id, false, null)
    on conflict (user_id) do nothing;
    return new;
end;
$$;

revoke all on function public.create_account_access_for_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created_account_access on auth.users;
create trigger on_auth_user_created_account_access
    after insert on auth.users
    for each row execute function public.create_account_access_for_new_user();
