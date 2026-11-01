# Mówik

## Subskrypcja Stripe (tryb testowy)

Checkout tworzy subskrypcję Stripe za 50 PLN miesięcznie. Supabase Edge Function weryfikuje sesję użytkownika i stałą cenę Stripe; wyłącznie podpisany webhook zapisuje jej status. Użytkownik może odczytać wyłącznie własny status. Subskrypcja nie jest obecnie wymagana do korzystania z aplikacji.

1. W Stripe Dashboard włącz **Test mode**, utwórz produkt „Mówik Plus” i cenę cykliczną **50,00 PLN / miesiąc**. Skopiuj identyfikator ceny `price_...`.
2. Zaloguj Supabase CLI i połącz projekt: `supabase login`, `supabase link --project-ref <project-ref>`.
3. Zastosuj migrację: `supabase db push`. Alternatywnie uruchom `supabase.sql` w SQL Editor Supabase (to pełny, istniejący skrypt schematu aplikacji).
4. Ustaw sekrety Edge Functions; wartości Stripe muszą pochodzić z **Test mode**. `APP_URL` to adres bazowy GitHub Pages bez końcowego ukośnika:

   ```sh
   supabase secrets set APP_URL=https://kyspiu.github.io/test01 STRIPE_SECRET_KEY=sk_test_... STRIPE_PRICE_ID=price_...
   ```

   `SUPABASE_URL`, `SUPABASE_ANON_KEY` i `SUPABASE_SERVICE_ROLE_KEY` są udostępniane funkcjom przez Supabase. Nie umieszczaj kluczy Stripe ani klucza service role w plikach repozytorium lub frontendzie.
5. Wdróż funkcje:

   ```sh
   supabase functions deploy create-checkout-session
   supabase functions deploy stripe-webhook
   ```

6. W Stripe Dashboard, nadal w **Test mode**, dodaj webhook `https://<project-ref>.supabase.co/functions/v1/stripe-webhook`. Zaznacz zdarzenia `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated` i `customer.subscription.deleted`. Skopiuj jego sekret podpisu (`whsec_...`) do Supabase:

   ```sh
   supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
   ```

7. Opublikuj zmiany statycznej aplikacji w GitHub Pages. Wróć do aplikacji po Checkout; status może pojawić się z opóźnieniem, gdy webhook zsynchronizuje dane.

W trybie testowym można użyć karty `4242 4242 4242 4242` z przyszłą datą ważności i dowolnym CVC. Nie używaj kluczy `sk_live_` ani rzeczywistych danych płatniczych podczas testów.
