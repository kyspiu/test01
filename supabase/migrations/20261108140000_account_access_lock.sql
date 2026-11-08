create table if not exists public.account_access (
    user_id uuid primary key references auth.users(id) on delete cascade,
    is_blocked boolean not null default false,
    reason text,
    updated_at timestamptz not null default now()
);

alter table public.account_access enable row level security;
revoke all on public.account_access from public, anon, authenticated;
grant select on public.account_access to authenticated;

drop policy if exists "users read own account access" on public.account_access;
create policy "users read own account access" on public.account_access
    for select to authenticated
    using (user_id = (select auth.uid()));

create or replace function public.current_user_is_blocked()
returns boolean
language sql
security definer
set search_path = ''
as $$
    select coalesce((
        select access_row.is_blocked
        from public.account_access as access_row
        where access_row.user_id = (select auth.uid())
    ), false);
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
