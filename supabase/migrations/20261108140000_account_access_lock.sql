create table if not exists public.account_access (
    user_id uuid primary key references auth.users(id) on delete cascade,
    is_blocked boolean not null default false,
    access_until timestamptz,
    reason text,
    updated_at timestamptz not null default now()
);

alter table public.account_access add column if not exists access_until timestamptz;

alter table public.account_access enable row level security;
revoke all on public.account_access from public, anon, authenticated;
grant select on public.account_access to authenticated;

drop policy if exists "users read own account access" on public.account_access;
create policy "users read own account access" on public.account_access
    for select to authenticated
    using (user_id = (select auth.uid()));

create or replace function public.extend_account_access(
    p_email text,
    p_days integer
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
    target_user_id uuid;
    new_access_until timestamptz;
begin
    if nullif(trim(p_email), '') is null then
        raise exception 'Email użytkownika jest wymagany.';
    end if;
    if p_days is null or p_days <= 0 then
        raise exception 'Liczba dni musi być większa od zera.';
    end if;

    select auth_user.id
    into strict target_user_id
    from auth.users as auth_user
    where lower(auth_user.email) = lower(trim(p_email));

    insert into public.account_access (user_id, is_blocked, access_until, reason, updated_at)
    values (target_user_id, false, now() + make_interval(days => p_days), null, now())
    on conflict (user_id) do update
    set is_blocked = false,
        access_until = greatest(
            coalesce(public.account_access.access_until, now()),
            now()
        ) + make_interval(days => p_days),
        reason = null,
        updated_at = now()
    returning access_until into new_access_until;

    return new_access_until;
end;
$$;

create or replace function public.block_account_access(
    p_email text,
    p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    target_user_id uuid;
begin
    if nullif(trim(p_email), '') is null then
        raise exception 'Email użytkownika jest wymagany.';
    end if;

    select auth_user.id
    into strict target_user_id
    from auth.users as auth_user
    where lower(auth_user.email) = lower(trim(p_email));

    insert into public.account_access (user_id, is_blocked, reason, updated_at)
    values (target_user_id, true, nullif(trim(p_reason), ''), now())
    on conflict (user_id) do update
    set is_blocked = true,
        reason = coalesce(nullif(trim(p_reason), ''), public.account_access.reason),
        updated_at = now();
end;
$$;

create or replace function public.unblock_account_access(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
    target_user_id uuid;
begin
    if nullif(trim(p_email), '') is null then
        raise exception 'Email użytkownika jest wymagany.';
    end if;

    select auth_user.id
    into strict target_user_id
    from auth.users as auth_user
    where lower(auth_user.email) = lower(trim(p_email));

    update public.account_access
    set is_blocked = false,
        reason = null,
        updated_at = now()
    where user_id = target_user_id;
end;
$$;

revoke all on function public.extend_account_access(text, integer) from public, anon, authenticated;
revoke all on function public.block_account_access(text, text) from public, anon, authenticated;
revoke all on function public.unblock_account_access(text) from public, anon, authenticated;
grant execute on function public.extend_account_access(text, integer) to service_role;
grant execute on function public.block_account_access(text, text) to service_role;
grant execute on function public.unblock_account_access(text) to service_role;

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

drop policy if exists "public read categories" on public.categories;
drop policy if exists "public insert categories" on public.categories;
drop policy if exists "public update categories audio" on public.categories;
drop policy if exists "public delete categories" on public.categories;
drop policy if exists "users manage own categories" on public.categories;
create policy "users manage own categories" on public.categories
    for all to authenticated
    using (
        user_id = (select auth.uid())
        and not public.current_user_is_blocked()
        and (parent_id is null or public.user_owns_category(parent_id))
    )
    with check (
        user_id = (select auth.uid())
        and not public.current_user_is_blocked()
        and (parent_id is null or public.user_owns_category(parent_id))
    );

drop policy if exists "public read words" on public.words;
drop policy if exists "public insert words" on public.words;
drop policy if exists "public update words audio" on public.words;
drop policy if exists "public delete words" on public.words;
drop policy if exists "users manage own words" on public.words;
create policy "users manage own words" on public.words
    for all to authenticated
    using (
        user_id = (select auth.uid())
        and not public.current_user_is_blocked()
        and public.user_owns_category(category_id)
    )
    with check (
        user_id = (select auth.uid())
        and not public.current_user_is_blocked()
        and public.user_owns_category(category_id)
    );

drop policy if exists "public read sentence_items" on public.sentence_items;
drop policy if exists "public insert sentence_items" on public.sentence_items;
drop policy if exists "public update sentence_items" on public.sentence_items;
drop policy if exists "public delete sentence_items" on public.sentence_items;
drop policy if exists "users manage own sentence items" on public.sentence_items;
create policy "users manage own sentence items" on public.sentence_items
    for all to authenticated
    using (
        user_id = (select auth.uid())
        and not public.current_user_is_blocked()
    )
    with check (
        user_id = (select auth.uid())
        and not public.current_user_is_blocked()
    );

drop policy if exists "public read word audio" on storage.objects;
drop policy if exists "public insert word audio" on storage.objects;
drop policy if exists "public update word audio" on storage.objects;
drop policy if exists "public delete word audio" on storage.objects;
drop policy if exists "public read sentence audio" on storage.objects;
drop policy if exists "public insert sentence audio" on storage.objects;
drop policy if exists "public update sentence audio" on storage.objects;
drop policy if exists "public delete sentence audio" on storage.objects;
drop policy if exists "users read own audio" on storage.objects;
drop policy if exists "users upload own audio" on storage.objects;
drop policy if exists "users update own audio" on storage.objects;
drop policy if exists "users delete own audio" on storage.objects;

create policy "users read own audio" on storage.objects
    for select to authenticated
    using (
        bucket_id in ('word-audio', 'sentence-audio')
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and not public.current_user_is_blocked()
    );

create policy "users upload own audio" on storage.objects
    for insert to authenticated
    with check (
        bucket_id in ('word-audio', 'sentence-audio')
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and not public.current_user_is_blocked()
    );

create policy "users update own audio" on storage.objects
    for update to authenticated
    using (
        bucket_id in ('word-audio', 'sentence-audio')
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and not public.current_user_is_blocked()
    )
    with check (
        bucket_id in ('word-audio', 'sentence-audio')
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and not public.current_user_is_blocked()
    );

create policy "users delete own audio" on storage.objects
    for delete to authenticated
    using (
        bucket_id in ('word-audio', 'sentence-audio')
        and (storage.foldername(name))[1] = (select auth.uid())::text
        and not public.current_user_is_blocked()
    );
