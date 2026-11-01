create table if not exists public.stripe_subscriptions (
    user_id uuid primary key references auth.users(id) on delete cascade,
    stripe_customer_id text unique,
    stripe_subscription_id text unique,
    status text not null check (status in (
        'incomplete', 'incomplete_expired', 'trialing', 'active',
        'past_due', 'canceled', 'unpaid', 'paused'
    )),
    current_period_end timestamptz,
    cancel_at_period_end boolean not null default false,
    last_event_created bigint not null default 0,
    updated_at timestamptz not null default now()
);

alter table public.stripe_subscriptions enable row level security;
revoke all on public.stripe_subscriptions from public, anon, authenticated;
grant select on public.stripe_subscriptions to authenticated;

drop policy if exists "users read own stripe subscription" on public.stripe_subscriptions;
create policy "users read own stripe subscription" on public.stripe_subscriptions
    for select to authenticated
    using (user_id = (select auth.uid()));

create or replace function public.sync_stripe_subscription(
    p_user_id uuid,
    p_stripe_customer_id text,
    p_stripe_subscription_id text,
    p_status text,
    p_current_period_end timestamptz,
    p_cancel_at_period_end boolean,
    p_event_created bigint
)
returns void
language sql
security definer
set search_path = ''
as $$
    insert into public.stripe_subscriptions (
        user_id,
        stripe_customer_id,
        stripe_subscription_id,
        status,
        current_period_end,
        cancel_at_period_end,
        last_event_created,
        updated_at
    )
    values (
        p_user_id,
        p_stripe_customer_id,
        p_stripe_subscription_id,
        p_status,
        p_current_period_end,
        coalesce(p_cancel_at_period_end, false),
        p_event_created,
        now()
    )
    on conflict (user_id) do update set
        stripe_customer_id = excluded.stripe_customer_id,
        stripe_subscription_id = excluded.stripe_subscription_id,
        status = excluded.status,
        current_period_end = excluded.current_period_end,
        cancel_at_period_end = excluded.cancel_at_period_end,
        last_event_created = excluded.last_event_created,
        updated_at = now()
    where excluded.last_event_created >= public.stripe_subscriptions.last_event_created;
$$;

revoke all on function public.sync_stripe_subscription(uuid, text, text, text, timestamptz, boolean, bigint)
    from public, anon, authenticated;
grant execute on function public.sync_stripe_subscription(uuid, text, text, text, timestamptz, boolean, bigint)
    to service_role;
