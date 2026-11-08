# Mówik

Mówik to aplikacja komunikacyjna wspierająca logowanie, osobiste listy zdań, reakcje, liczby, daty i nagrane szybkie odpowiedzi.

Aplikacja nie zawiera obecnie zakupu ani informacji o płatnościach/subskrypcji. Płatności są obsługiwane ręcznie poza aplikacją. Istniejące funkcje Edge Functions Stripe i schemat bazy danych pozostają zachowane, ale frontend ich nie wywołuje.

Aplikacja statyczna jest hostowana w GitHub Pages. Opublikowanie zmian na skonfigurowanej gałęzi Pages aktualizuje witrynę. Supabase nadal obsługuje uwierzytelnianie i dane użytkowników.

## Ręczne blokowanie konta

Blokada jest ręczna i nie jest automatycznie powiązana z płatnościami ani Stripe. Przed opublikowaniem frontendu administrator musi zastosować migrację `supabase/migrations/20261108140000_account_access_lock.sql` w projekcie Supabase. Flaga `public.account_access.is_blocked` blokuje dostęp do aplikacji oraz do własnych rekordów i plików audio przez RLS; nie usuwa konta, lokalnych danych ani danych w Supabase. Użytkownik może nadal wylogować się z ekranu blokady.

W Supabase Dashboard otwórz **SQL Editor**, zastąp `UUID_KONTA` dokładnym UUID użytkownika z **Authentication → Users** i uruchom:

```sql
insert into public.account_access (user_id, is_blocked, reason)
values ('UUID_KONTA'::uuid, true, 'Brak płatności')
on conflict (user_id) do update
set is_blocked = excluded.is_blocked,
    reason = excluded.reason,
    updated_at = now();
```

Aby odblokować konto, uruchom:

```sql
update public.account_access
set is_blocked = false,
    reason = null,
    updated_at = now()
where user_id = 'UUID_KONTA'::uuid;
```

Oba polecenia zmieniają wyłącznie flagę dostępu i powód; nie kasują użytkownika, zdań, nagrań ani innych danych.
