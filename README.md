# Mówik

Mówik to aplikacja komunikacyjna wspierająca logowanie, osobiste listy zdań, reakcje, liczby, daty i nagrane szybkie odpowiedzi.

Aplikacja nie zawiera obecnie zakupu ani informacji o płatnościach/subskrypcji. Płatności są obsługiwane ręcznie poza aplikacją. Istniejące funkcje Edge Functions Stripe i schemat bazy danych pozostają zachowane, ale frontend ich nie wywołuje.

Aplikacja statyczna jest hostowana w GitHub Pages. Opublikowanie zmian na skonfigurowanej gałęzi Pages aktualizuje witrynę. Supabase nadal obsługuje uwierzytelnianie i dane użytkowników.

## Ręczne zarządzanie dostępem do kont

Dostęp jest zarządzany ręcznie przez administratora i nie jest automatycznie powiązany z płatnościami ani Stripe. Przed opublikowaniem frontendu administrator musi zastosować w tej kolejności migracje `supabase/migrations/20261108140000_account_access_lock.sql` oraz `supabase/migrations/20261108150000_require_account_access_grant.sql` w projekcie Supabase: Dashboard → **SQL Editor** → wklej zawartość każdego pliku osobno i uruchom jako administrator projektu. Pierwsza migracja tworzy tabelę dostępu, funkcje administracyjne i RLS blokujące odczyt/zapis danych oraz audio po ręcznej blokadzie lub wygaśnięciu terminu. Druga wprowadza zasadę, że konto bez wpisu przyznającego dostęp jest domyślnie zablokowane.

Tabela `public.account_access` przechowuje UUID z `auth.users` jako klucz wewnętrzny; funkcje administratora rozwiązują email na UUID przy każdym wywołaniu. Zmiana emaila nie zmienia właściciela danych. Zwykli użytkownicy mogą odczytać wyłącznie własny status; nie mogą zmieniać tabeli ani uruchamiać funkcji administratora. Funkcje są dostępne dla `service_role` i administratora projektu w SQL Editor. Nie umieszczaj klucza `service_role` we frontendzie.

W SQL Editor uruchom, podając email i liczbę dni, aby nadać lub przedłużyć dostęp:

```sql
select public.extend_account_access('uzytkownik@example.com', 365);
```

Wynik to nowy `access_until`. Dni są dodawane od późniejszej z dat: aktualnego `access_until` lub `now()`; przedłużenie nie przepada, jeśli nastąpi przed wygaśnięciem. Po wygaśnięciu dostęp jest blokowany dynamicznie względem czasu w bazie — bez codziennego zadania cron. Brak wiersza w `account_access` oznacza blokadę do czasu przyznania dostępu. Wiersz z `is_blocked = false` i `access_until IS NULL` oznacza dostęp bezterminowy; standardowo używaj `extend_account_access`, aby przyznać dostęp na konkretną liczbę dni.

Pozostałe dni (z zaokrągleniem w górę do najbliższego dnia) można sprawdzić w dowolnym momencie; wynik jest wyliczany z `now()`, a nie zapisywany ani aktualizowany przez cron:

```sql
select auth_user.email,
       account_access.access_until,
       greatest(
           ceil(extract(epoch from (account_access.access_until - now())) / 86400),
           0
       )::integer as remaining_days
from auth.users as auth_user
join public.account_access as account_access on account_access.user_id = auth_user.id
where lower(auth_user.email) = lower('uzytkownik@example.com');
```

Aby natychmiast zablokować konto (niezależnie od terminu):

```sql
select public.block_account_access('uzytkownik@example.com', 'Brak płatności');
```

Aby zdjąć ręczną blokadę, pozostawiając pierwotny termin ważności:

```sql
select public.unblock_account_access('uzytkownik@example.com');
```

Zdjęcie ręcznej blokady nie przywróci dostępu, jeśli `access_until` już minął. W takiej sytuacji najpierw dodaj dni przez `extend_account_access`. Blokowanie, wygasanie i przedłużanie nie kasują konta, zdań, lokalnego `localStorage`, nagrań ani innych danych. Nie mogą jednak cofnąć kopii danych wcześniej pobranych na urządzenie użytkownika.
