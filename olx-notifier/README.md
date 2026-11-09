# Powiadomienia o okazjach z OLX

Skrypt obserwuje **publiczną stronę wyników wyszukiwania** OLX, wybiera ogłoszenia pasujące do słów kluczowych, porównuje ceny z medianą wyników i wysyła nowe okazje przez Telegram. Wymaga Pythona 3.10+; nie potrzebuje dodatkowych pakietów.

## Ważne ograniczenie OLX

OLX udostępnia dokumentację API dla zarejestrowanych integracji, ale nie udało się potwierdzić w niej publicznego endpointu do wyszukiwania cudzych ogłoszeń. Dlatego skrypt korzysta wyłącznie ze zwykłej, publicznej strony wyników wyszukiwania, a nie z prywatnego API. To nie jest oficjalne API ani stabilny kontrakt: układ strony może się zmienić. Przed użyciem sprawdź aktualny regulamin OLX i upewnij się, że takie korzystanie jest dozwolone. Jeśli OLX blokuje dostęp, zwraca CAPTCHA albo limit (HTTP 403/429/503), skrypt zatrzymuje się — nie próbuje omijać blokady, logowania, CAPTCHA ani limitów.

## Konfiguracja

1. Skopiuj `config.example.json` do `config.json`:

   ```powershell
   Copy-Item .\olx-notifier\config.example.json .\olx-notifier\config.json
   ```

2. W `search_url` wklej adres wyników wyszukiwania skopiowany z OLX. Ustaw `include_keywords`, aby tytuł zawierał wszystkie wskazane hasła, a `exclude_keywords`, aby odrzucić niepasujące warianty (np. całe komputery).
3. Utwórz bota przez oficjalnego `@BotFather` w Telegramie, rozpocznij z nim rozmowę i ustaw dane dostępowe jako zmienne środowiskowe. Nie wpisuj tokena do pliku konfiguracyjnego ani repozytorium.

PowerShell (dla bieżącego okna):

```powershell
$env:TELEGRAM_BOT_TOKEN = "token-od-BotFather"
$env:TELEGRAM_CHAT_ID = "twoj-chat-id"
```

`TELEGRAM_CHAT_ID` to identyfikator rozmowy prywatnej lub grupy, do której bot może wysyłać wiadomości. W grupie dodaj bota i pobierz identyfikator grupy z zaufanego źródła.

## Uruchomienie

Pojedyncze sprawdzenie:

```powershell
py -3 .\olx-notifier\olx_deal_notifier.py --once
```

Ciągłe sprawdzanie (domyślnie co 15 minut):

```powershell
py -3 .\olx-notifier\olx_deal_notifier.py
```

Możesz wskazać inny plik konfiguracji przez `--config ścieżka`. Skrypt pobiera tylko pierwszą stronę wyników i nie częściej niż co 10 minut. Powtarzające się ogłoszenia są zapisywane w `olx-notifier-sent.json` (lokalny plik stanu; nie umieszczaj w nim sekretów). Stan jest zapisywany po udanym wysłaniu, aby nie oznaczać niewysłanej oferty jako dostarczonej.

## Wyliczanie ceny rynkowej

Domyślnie punktem odniesienia jest mediana cen ofert z pierwszej strony, które pasują do `include_keywords` i nie pasują do `exclude_keywords`. Skrypt wymaga minimum 5 takich ofert; przy mniejszej próbie nie wysyła alertów, bo wycena byłaby zbyt słaba. Możesz ustawić własną wartość `market_price_pln`, jeśli znasz wiarygodną cenę odniesienia. Alert pojawia się, gdy cena jest co najmniej o `minimum_discount_percent` procent niższa od mediany lub podanej ceny.

To porównanie cen ofertowych, nie transakcyjnych — wynik jest orientacyjny. Dobrze zawęź wyszukiwanie i sprawdzaj ogłoszenie przed zakupem.

## Testy

```powershell
py -3 -m unittest discover -s .\olx-notifier -v
```
