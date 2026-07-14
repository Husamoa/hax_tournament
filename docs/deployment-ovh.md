# Wdrożenie na OVH (krok po kroku)

Cel: uruchomić aplikację pod `https://pitole.pl` na hostingu współdzielonym OVH
(PHP + MySQL), bez build-stepu, wgrywając pliki przez FTP.

Układ docelowy w web roocie (np. katalog `www/`):
```
www/
  index.html  app.js  api.js  schedule.js  ranking.js  styles.css   ← zawartość public/
  api/
    index.php  db.php  config.php                                    ← katalog api/
```
Frontend woła API ścieżką względną `api/index.php`, więc wystarczy, że `api/` leży w web roocie.

---

## 1. Sprawdź, czy plan ma bazę MySQL

OVH Manager → **Hosting** → *twój hosting* → zakładka **Bazy danych**.
- Jest MySQL (choćby 1) → dalej.
- Brak baz → patrz sekcja **Brak bazy** na końcu.

## 2. Utwórz bazę MySQL

Manager → Bazy danych → **Utwórz bazę danych** (MySQL). Zapisz:
- **host** (np. `pitolexxxx.mysql.db`), **nazwa bazy**, **użytkownik**, **hasło**.

## 3. Zaimportuj schemat

Manager → Bazy danych → **phpMyAdmin** (zaloguj danymi z kroku 2) → wybierz swoją bazę →
zakładka **Import** → wgraj [`schema.sql`](../schema.sql) → **Wykonaj**.
Powinny powstać tabele: `players`, `tournaments`, `tournament_players`, `matches`.

## 4. Ustaw PHP 8.x

W web roocie utwórz plik `.ovhconfig`:
```
app.engine=php
app.engine.version=8.2
```
(albo wybierz wersję PHP w Managerze → Hosting → Więcej opcji → Wersja PHP).

## 5. Przygotuj `api/config.php`

1. Skopiuj `config.sample.php` → `api/config.php`.
2. Wpisz dane bazy z kroku 2 (sekcja MySQL — zostaw ją odkomentowaną, SQLite zakomentuj):
   ```php
   'db_dsn'  => 'mysql:host=pitolexxxx.mysql.db;dbname=NAZWA;charset=utf8mb4',
   'db_user' => 'UZYTKOWNIK',
   'db_pass' => 'HASLO',
   ```
3. Wygeneruj **hash wspólnego hasła ekipy** (lokalnie, masz XAMPP):
   ```bash
   php -r "echo password_hash('TWOJE_HASLO', PASSWORD_DEFAULT), PHP_EOL;"
   ```
   Wynik (zaczyna się od `$2y$...`) wklej do `'password_hash' => '...'`.

`api/config.php` **nie** jest w repo (`.gitignore`) — tworzysz go ręcznie na serwerze/lokalnie.

## 6. Wgraj pliki przez FTP

Dane FTP: Manager → Hosting → **FTP-SSH** (host, login, hasło). Klient np. FileZilla.

Do web roota (`www/`):
- wgraj **zawartość** katalogu `public/` (pliki `index.html`, `*.js`, `styles.css`) — do samego `www/`,
- wgraj katalog **`api/`** (z `index.php`, `db.php` i uzupełnionym `config.php`) — do `www/api/`.

Nie wgrywaj: `tests/`, `node_modules/`, `dev-server.php`, `schema.sqlite.sql`, `*.sqlite`,
`.idea/` — są niepotrzebne na produkcji.

## 7. Podłącz domenę `pitole.pl`

Manager → **Multisite** → dodaj/edytuj `pitole.pl`:
- wskaż katalog główny na web root z plikami (np. `www` lub podfolder, jeśli tam wgrałeś),
- włącz **SSL** (Let's Encrypt jest darmowy w OVH) i **wymuś HTTPS** (hasło leci przez sieć —
  HTTPS jest obowiązkowe).

Propagacja DNS/SSL może chwilę potrwać.

## 8. Test na produkcji

Otwórz `https://pitole.pl`:
1. Zaloguj się wspólnym hasłem.
2. Zakładka **Gracze** → dodaj kilku graczy.
3. **Turniej** → zaznacz min. 4 → *Generuj* → *Przelosuj* → *Rozpocznij*.
4. Wpisz wynik; spróbuj remisu (np. 5:5) → musi zostać zablokowany.
5. **Tabela** → sprawdź ranking; **Zakończ** → sprawdź **Historię** i szczegóły.

---

## Aktualizacje aplikacji

Podmieniasz zmienione pliki przez FTP. **Nie nadpisuj `api/config.php`.** Zmiany w
`schema.sql` (nowe kolumny) nanieś w phpMyAdmin.

## Bezpieczeństwo

- `api/config.php` to plik PHP wykonywany po stronie serwera — jego treść nie jest zwracana
  jako źródło. Trzymaj poprawne uprawnienia i nigdy nie commituj.
- Dostęp chroniony wspólnym hasłem + sesją; wymuś HTTPS (krok 7).

## Brak bazy MySQL w planie

Jeśli plan OVH nie ma żadnej bazy:
- **Najprościej:** zmień plan hostingu na najtańszy z 1× MySQL (Perso/Pro zwykle mają) i wróć do kroku 2.
- **Alternatywa (fallback z planu):** statyczny frontend na OVH + darmowy Postgres (Supabase).
  Wymaga przełączenia `api/db.php` na PDO `pgsql` i osobnej konfiguracji — do ustalenia osobno.
