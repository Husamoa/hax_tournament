# Wdrożenie na OVH (krok po kroku)

Cel: uruchomić aplikację pod `https://pitole.pl`. Produkcja stoi na **darmowym hostingu
OVH 100M** (PHP 8.2) z bazą **SQLite** — bez build-stepu, pliki wgrywa się przez FTP.

> **Dlaczego SQLite, nie MySQL?** Darmowy hosting OVH do domeny nie ma bazy MySQL, a aplikacja
> waży < 1 MB i obsługuje ruch małej ekipy — SQLite w zupełności wystarcza. Kod wspiera też
> MySQL (patrz sekcja **Wariant MySQL** na końcu), gdyby kiedyś przejść na płatny plan.

Układ docelowy w web roocie (`www/`):
```
www/
  index.html  app.js  api.js  schedule.js  ranking.js  stats.js  styles.css   ← zawartość public/
  .htaccess                                                                    ← wymusza HTTPS
  api/
    index.php  db.php  config.php  pitole.sqlite  .htaccess                    ← katalog api/ + baza
```
Frontend woła API ścieżką względną `api/index.php`, więc wystarczy, że `api/` leży w web roocie.

---

## Część A — pierwsze (ręczne) wdrożenie

### 1. Aktywuj darmowy hosting dla domeny

OVH Manager → **Web Cloud → Hosting**. Jeśli nie masz hostingu przy domenie, aktywuj darmowy
plan 100M (dołączany do domen w OVH). Zapewnia PHP 8.x i darmowy SSL (Let's Encrypt).

### 2. Podłącz domenę (Multisite)

Manager → Hosting → *twój hosting* → zakładka **Multisite** → **Dodaj domenę lub subdomenę**:
- dodaj `pitole.pl` **oraz** `www.pitole.pl`,
- **katalog główny:** `www`,
- zaznacz **SSL**.

Jeśli DNS domeny wskazuje jeszcze na parking OVH (rekordy A na `213.186.33.5`), skieruj oba
rekordy **A** (`@` i `www`) na adres klastra hostingu (Manager → Hosting → *Informacje ogólne*
→ pole **IPv4**) i usuń domyślne przekierowanie OVH (dwa wpisy TXT: `1|www.pitole.pl` i
`3|welcome`). Certyfikat Let's Encrypt wystawi się automatycznie, gdy DNS wskaże na klaster
(status w zakładce **Certyfikaty SSL**: `Trwa tworzenie` → data ważności).

### 3. Ustaw PHP 8.x

W katalogu **głównym** hostingu (nie w `www`) utwórz plik `.ovhconfig`:
```
app.engine=php
app.engine.version=8.2
```
(albo wybierz wersję PHP w Managerze). PHP 8.x jest wymagane (`str_starts_with`, typy).
Potrzebne rozszerzenia: `pdo_sqlite`, `mbstring` — na darmowym planie są dostępne.

### 4. Przygotuj bazę SQLite i `api/config.php` (lokalnie)

```bash
# 1. Świeża baza ze schematu SQLite
php -r '$p=new PDO("sqlite:pitole.sqlite");$p->exec(file_get_contents("schema.sqlite.sql"));'

# 2. Hash wspólnego hasła ekipy
php -r "echo password_hash('TWOJE_HASLO', PASSWORD_DEFAULT), PHP_EOL;"
```
Utwórz `api/config.php` (wzór: [`config.sample.php`](../config.sample.php)) z DSN SQLite i hashem:
```php
return [
    'db_dsn'  => 'sqlite:' . __DIR__ . '/pitole.sqlite',
    'db_user' => null,
    'db_pass' => null,
    'password_hash' => '$2y$...WYGENEROWANY_HASH...',
];
```
`api/config.php` i `*.sqlite` są w `.gitignore` — nie trafiają do repo, tworzysz je ręcznie.

### 5. Ochrona plików `.htaccess`

- `www/.htaccess` — wymusza HTTPS (hasło leci w requestach). Wzór:
  [`.github/deploy/htaccess-www`](../.github/deploy/htaccess-www).
- `www/api/.htaccess` — blokuje serwowanie pliku bazy po HTTP. Wzór:
  [`.github/deploy/htaccess-api`](../.github/deploy/htaccess-api).

### 6. Wgraj pliki przez FTP

Dane FTP: Manager → Hosting → **FTP-SSH**. Klient np. FileZilla. Do `www/`:
- **zawartość** katalogu `public/` (pliki `index.html`, `*.js`, `styles.css`) — do samego `www/`,
- katalog **`api/`** (z `index.php`, `db.php`, `config.php`, `pitole.sqlite`) — do `www/api/`,
- oba pliki `.htaccess` (patrz krok 5).

Nie wgrywaj: `tests/`, `node_modules/`, `dev-server.php`, `schema*.sql`, `*/CLAUDE.md`,
`docker*`, `.idea/`, `.github/` — niepotrzebne na produkcji.

### 7. Test na produkcji

Otwórz `https://pitole.pl`:
1. Zaloguj się wspólnym hasłem (sprawdza PHP + odczyt SQLite).
2. **Gracze** → dodaj kilku (sprawdza zapis do SQLite).
3. **Turniej** → zaznacz min. 4 → *Generuj* → *Rozpocznij* → wpisz wynik; spróbuj remisu (5:5) → zablokowany.
4. **Tabela** → ranking; **Zakończ** → **Historia**.
5. Sprawdź, że baza nie jest publiczna: `https://pitole.pl/api/pitole.sqlite` musi dać **403**.

---

## Część B — automatyczny deploy (GitHub → push `main` → OVH)

Po pierwszym ręcznym wdrożeniu aktualizacje idą automatycznie. Workflow
[`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) na każdy push do `main`:
odpala testy (`node --test`), składa produkcyjny układ i synchronizuje go na OVH przez **FTPS**.

### 1. Dodaj sekrety w repozytorium GitHub

Repo → **Settings → Secrets and variables → Actions → New repository secret**. Dodaj trzy:

| Sekret | Wartość (z OVH → Hosting → **FTP-SSH**) |
|---|---|
| `FTP_SERVER` | host FTP, np. `ftp.cluster129.hosting.ovh.net` |
| `FTP_USERNAME` | login FTP |
| `FTP_PASSWORD` | hasło FTP |

**Zalecane:** załóż w OVH osobnego użytkownika FTP tylko do CI (Hosting → FTP-SSH → dodaj
użytkownika), zamiast dawać GitHubowi główne poświadczenia.

### 2. Co robi (i czego NIE rusza) sync

- Wgrywa **tylko zmienione** pliki (sync różnicowy), do katalogu `www/` na serwerze.
- **Nigdy nie dotyka `api/config.php` ani `pitole.sqlite`** — są w `exclude`, więc nie zostaną
  nadpisane ani skasowane. Config i baza żyją wyłącznie na serwerze.
- `config.php` i `*.sqlite` są gitignored, więc i tak nie ma ich w repo/paczce.

### 3. `server-dir` — jedyna rzecz do ewentualnej zmiany

Workflow zakłada `server-dir: www/` (główny użytkownik FTP ląduje w katalogu domowym, w którym
jest `www/`). Jeśli używasz użytkownika FTP z katalogiem domowym ustawionym **wprost na `www`**,
zmień w workflow `server-dir` na `./`.

### 4. Odpalenie

Zrób push do `main` (albo uruchom ręcznie: zakładka **Actions** → *Deploy na OVH* → **Run
workflow**). Postęp i logi widać w zakładce **Actions**.

---

## Aktualizacje aplikacji

- **Kod (JS/PHP/CSS):** push do `main` → auto-deploy (Część B). Ręcznie: podmień pliki w `www/`
  przez FTP, **nie nadpisuj `api/config.php` ani `pitole.sqlite`**.
- **Zmiany schematu bazy** (`schema.sqlite.sql`): brak systemu migracji (świadoma decyzja —
  projekt hobbystyczny). Nowe tabele/kolumny nanieś ręcznie na bazie produkcyjnej — np. pobierz
  `pitole.sqlite` przez FTP, zastosuj DDL lokalnie (`sqlite3 pitole.sqlite < zmiana.sql`) i wgraj
  z powrotem, albo wykonaj DDL innym narzędziem SQLite. Auto-deploy celowo **nie** rusza bazy.

## Bezpieczeństwo

- `api/config.php` to plik PHP wykonywany po stronie serwera — treść nie jest zwracana jako
  źródło. Nigdy nie commituj (gitignored).
- Plik bazy `pitole.sqlite` leży w web roocie, dlatego `www/api/.htaccess` blokuje jego
  serwowanie po HTTP. Po wdrożeniu potwierdź, że `…/api/pitole.sqlite` daje **403**.
- Dostęp chroniony wspólnym hasłem + sesją; HTTPS wymuszony przez `www/.htaccess`.
- Do CI używaj dedykowanego użytkownika FTP (nie głównego konta).

## Wariant MySQL (opcjonalnie — płatny plan)

Gdybyś przeszedł na hosting z MySQL (np. Perso/Pro):
1. Manager → **Bazy danych** → utwórz bazę MySQL (zapisz host, nazwę, użytkownika, hasło).
2. **phpMyAdmin** → Import → wgraj [`schema.sql`](../schema.sql).
3. W `api/config.php` ustaw DSN MySQL zamiast SQLite:
   ```php
   'db_dsn'  => 'mysql:host=xxxx.mysql.db;dbname=NAZWA;charset=utf8mb4',
   'db_user' => 'UZYTKOWNIK',
   'db_pass' => 'HASLO',
   ```
4. Rozszerzenie `pdo_mysql` musi być włączone. Reszta (frontend, deploy) bez zmian — pamiętaj
   tylko, że wtedy `pitole.sqlite` nie jest używany.
