# Alerty Dolnośląskie

Instalowalna aplikacja webowa w języku polskim. Pokazuje publikacje RCB dotyczące województwa dolnośląskiego, a przycisk **Źródło** otwiera konkretny komunikat na gov.pl. Użytkownik może włączyć powiadomienia Web Push, które system może wyświetlić również po zamknięciu aplikacji.

## Publikacja przez GitHub i Vercel

1. Utwórz repozytorium na GitHubie i wgraj całą zawartość tego katalogu, włącznie z ukrytym katalogiem `.github`. Workflow musi być na domyślnej gałęzi repozytorium.
2. Utwórz projekt na planie Free w Supabase. Otwórz **SQL Editor → New query**, wklej cały plik `supabase.sql` i kliknij **Run**. Skopiuj adres **Project URL** i klucz **Secret key** zaczynający się od `sb_secret_`. W Vercel wybierz **Add New → Project**, wskaż repozytorium i upewnij się, że katalog projektu to ten zawierający `vercel.json`.
3. Wygeneruj własne klucze push. Uruchom w katalogu projektu polecenia:

   ```sh
   npm ci
   npm run keys
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

4. W ustawieniach projektu Vercel dodaj zmienne dla środowiska **Production**.

   | Zmienna | Wartość |
   | --- | --- |
   | `SUPABASE_URL` | Project URL z Supabase |
   | `SUPABASE_SECRET_KEY` | Secret key z Supabase |
   | `VAPID_PUBLIC_KEY` | `publicKey` z generatora |
   | `VAPID_PRIVATE_KEY` | `privateKey` z generatora |
   | `VAPID_SUBJECT` | Twój adres kontaktowy w formacie `mailto:adres@example.com` |
   | `CRON_SECRET` | Losowy ciąg z ostatniego polecenia |

   Wdróż aplikację i zapisz jej publiczny adres produkcyjny HTTPS. Klucz prywatny, klucz Supabase i sekret synchronizacji trzymaj w ustawieniach usług. Zachowaj klucze VAPID przy kolejnych wdrożeniach, ponieważ telefon wiąże subskrypcję z kluczem publicznym.

5. W GitHubie otwórz **Settings → Secrets and variables → Actions**. W **Variables** dodaj `APP_URL` z adresem produkcyjnym Vercel. W **Secrets** dodaj `CRON_SECRET` z tą samą wartością co na Vercel.
6. Otwórz **Actions → Sprawdź nowe alerty → Run workflow**. Po udanym uruchomieniu odśwież aplikację. Harmonogram sprawdza RCB co pięć minut, a starsze komunikaty dochodzą partiami po kolejnych uruchomieniach. W repozytorium trzeba mieć włączone GitHub Actions.

## Na telefonie

- **Android** — otwórz adres w Chrome, opcjonalnie wybierz instalację z menu przeglądarki, a następnie w aplikacji wybierz **Włącz powiadomienia** i zaakceptuj zgodę.
- **iPhone i iPad (iOS/iPadOS 16.4+)** — w Safari wybierz **Udostępnij → Do ekranu początkowego**. Otwórz aplikację z nowej ikony, wybierz **Włącz powiadomienia** i zaakceptuj zgodę.

Po pojawieniu się nowego komunikatu objętego zasięgiem synchronizacja zapisze go i wyśle powiadomienie. Dotknięcie powiadomienia otwiera komunikat na gov.pl. Wyłączenie zgody w aplikacji usuwa subskrypcję z bazy.

## Zasięg i częstotliwość

- Aplikacja przegląda [stronę główną RCB](https://www.gov.pl/web/rcb/) i [mapę strony RCB](https://www.gov.pl/web/rcb/mapa-strony). Rozpoznaje obszar po treści publikacji, w tym po nazwie województwa, wybranych nazwach lokalnych i sformułowaniach oznaczających zasięg ogólnopolski. Kompletność zależy od zawartości indeksu i sposobu opisania obszaru przez RCB. Powiadomienia są wysyłane przy pierwszym wykryciu świeżych publikacji, a starsze trafiają do archiwum.
- GitHub Actions może opóźnić wykonanie harmonogramu. W publicznych repozytoriach harmonogram może się wyłączyć po 60 dniach bez aktywności. [Harmonogramy GitHub Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- Standardowy runner w publicznym repozytorium jest bezpłatny. Prywatne repozytorium ma miesięczny limit i przy sprawdzaniu co pięć minut może go wyczerpać. [Rozliczenia GitHub Actions](https://docs.github.com/en/actions/concepts/billing-and-usage)
- Na Vercel Pro można zamiast GitHub Actions dodać do `vercel.json` pole `"crons": [{ "path": "/api/sync", "schedule": "*/5 * * * *" }]` i wyłączyć harmonogram GitHuba. Vercel Hobby obsługuje zadania raz dziennie. [Limity Vercel Cron](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing)
- Publikacje mogą pojawić się później niż oficjalny SMS, a push zależy od internetu i ustawień telefonu. Oficjalny kanał ostrzegania opisuje [RCB](https://www.gov.pl/web/rcb/alert-rcb---najwazniejsze-pytania-i-odpowiedzi).

Testy parsera można uruchomić poleceniem `npm test`.
