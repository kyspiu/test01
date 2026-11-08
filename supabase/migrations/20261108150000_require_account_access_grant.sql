create or replace function public.current_user_is_blocked()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select coalesce((
        select access_row.is_blocked
            or (access_row.access_until is not null and access_row.access_until <= now())
        from public.account_access as access_row
        where access_row.user_id = (select auth.uid())
    ), true);
$$;

revoke all on function public.current_user_is_blocked() from public, anon;
grant execute on function public.current_user_is_blocked() to authenticated;
