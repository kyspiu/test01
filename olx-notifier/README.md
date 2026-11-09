# Powiadomienia o okazjach z OLX

Skrypt przyjmuje polecenia z Telegrama, obserwuje **publiczne strony wyników wyszukiwania** OLX, porównuje ceny z medianą wyników i wysyła nowe okazje na Telegram. Wymaga Pythona 3.10+; nie potrzebuje dodatkowych pakietów.

## Ważne ograniczenie OLX

OLX udostępnia dokumentację API dla zarejestrowanych integracji, ale nie udało się potwierdzić w niej publicznego endpointu do wyszukiwania cudzych ogłoszeń. Dlatego skrypt korzysta wyłącznie ze zwykłej, publicznej strony wyników wyszukiwania, a nie z prywatnego API. To nie jest oficjalne API ani stabilny kontrakt: układ strony może się zmienić. Przed użyciem sprawdź aktualny regulamin OLX i upewnij się, że takie korzystanie jest dozwolone. Jeśli OLX blokuje dostęp, zwraca CAPTCHA albo limit (HTTP 403/429/503), skrypt zatrzymuje się — nie próbuje omijać blokady, logowania, CAPTCHA ani limitów.

## Konfiguracja

1. Skopiuj `config.example.json` do `config.json`:

   ```powershell
   Copy-Item .\olx-notifier\config.example.json .\olx-notifier\config.json
   ```

2. Utwórz bota przez oficjalnego `@BotFather` w Telegramie, rozpocznij z nim rozmowę i ustaw dane dostępowe jako zmienne środowiskowe. Nie wpisuj tokena do pliku konfiguracyjnego ani repozytorium.

PowerShell (dla bieżącego okna):

```powershell
$env:TELEGRAM_BOT_TOKEN = "token-od-BotFather"
$env:TELEGRAM_CHAT_ID = "twoj-chat-id"
```

`TELEGRAM_CHAT_ID` to identyfikator rozmowy prywatnej lub grupy, do której bot może wysyłać wiadomości. Polecenia sterujące są wykonywane wyłącznie dla tej rozmowy; wiadomości z innych chatów są ignorowane. W grupie dodaj bota i pobierz identyfikator grupy z zaufanego źródła. Bot używa Telegram Bot API `getUpdates`; jeśli dla bota skonfigurowano webhook, usuń go przed uruchomieniem.

## Polecenia Telegrama

Uruchom skrypt w trybie ciągłym, a następnie wyślij botowi:

```text
/szukaj RTX3060 TI 50% ceny rynkowej
```

Wyszukiwanie zapisze się lokalnie i będzie monitorowane po cenie z pierwszej strony wyników OLX. W przykładzie alert pojawi się dla ofert co najmniej 50% tańszych od mediany pasujących ogłoszeń. Skrypt wymaga minimum 5 pasujących ofert do wyliczenia mediany; przy mniejszej próbce nie wysyła alertu. Nowe polecenia można wysyłać w dowolnym momencie, a ustawienia przetrwają ponowne uruchomienie skryptu.

Pozostałe polecenia:

```text
/moje        - pokaż zapisane wyszukiwania i ich progi
/usun 1      - usuń wyszukiwanie nr 1 z listy /moje
/pomoc       - pokaż skróconą instrukcję
```

Można zapisać maksymalnie 10 wyszukiwań. Ponowne dodanie tego samego zapytania zmienia jego próg. Procent jest ograniczony do 1-90. Zwrot „ceny rynkowej” można pominąć, np. `/szukaj RTX 3060 Ti 50%`.

## Uruchomienie

Pojedyncze sprawdzenie:

```powershell
py -3 .\olx-notifier\olx_deal_notifier.py --once
```

Ciągłe sprawdzanie (domyślnie co 15 minut):

```powershell
py -3 .\olx-notifier\olx_deal_notifier.py
```

Możesz wskazać inny plik konfiguracji przez `--config ścieżka`. Skrypt pobiera tylko pierwszą stronę wyników i nie częściej niż co 10 minut; różne wyszukiwania odpytuje z co najmniej 5-sekundowym odstępem, a aktualizacje Telegrama sprawdza przez długie odpytywanie. W `olx-notifier-sent.json` zapisywane są wysłane oferty, polecenia Telegrama i wyszukiwania (lokalny plik stanu; nie umieszczaj w nim sekretów). Stan jest zapisywany po udanym wysłaniu, aby nie oznaczać niewysłanej oferty jako dostarczonej. Poprzedni format pliku stanu zawierający samą listę ofert jest migrowany automatycznie.

## Wyliczanie ceny rynkowej

Polecenia Telegrama szukają podanego zapytania i używają mediany cen wyników pasujących do słów z zapytania. Istniejące pliki konfiguracyjne z `search_url` nadal mogą definiować dodatkowe wyszukiwanie statyczne, z progiem `minimum_discount_percent` oraz `market_price_pln` jako opcjonalną ręczną ceną odniesienia.

To porównanie cen ofertowych, nie transakcyjnych — wynik jest orientacyjny. Dobrze zawęź wyszukiwanie i sprawdzaj ogłoszenie przed zakupem.

## Testy

```powershell
py -3 -m unittest discover -s .\olx-notifier -v
```
