# CLAUDE.md — Pitole (turnieje HaxBall 2v2)

Przewodnik dla AI i nowych osób. Zacznij tutaj.

## Co to jest

Aplikacja webowa dla ekipy **Pitole** do prowadzenia turniejów HaxBall 2v2 z losowanymi
składami i **indywidualnym** rankingiem graczy. Domena docelowa: `pitole.pl` (hosting OVH).

## Stack (świadomie prosty — pod OVH bez build-stepu)

- **Backend:** PHP 8, PDO. Cienkie API JSON. Routing query-string (`api/index.php?r=...`).
- **Baza:** **SQLite** — jedyna baza, tak samo na produkcji (darmowy hosting OVH) i lokalnie
  (schemat: `schema.sqlite.sql`). Bez serwera bazy — plik `.sqlite` obok API.
- **Frontend:** SPA — vanilla JS (moduły ES), bez frameworka i bez builda.
- **Dostęp:** jedno wspólne hasło ekipy → sesja PHP (cookie). Bez kont per gracz.

Nie ma kroku budowania. Pliki wgrywa się jak są (FTP). Node jest używany **tylko** do
uruchomienia testów logiki lokalnie.

## Mapa repozytorium

| Ścieżka | Rola |
|---|---|
| `api/index.php` | Router API — wszystkie endpointy, logowanie, walidacja serwerowa |
| `api/db.php` | **JEDYNA** warstwa dostępu do bazy: `DB::pdo()` + klasa `Repo` (cały SQL) |
| `api/config.php` | Sekrety (DSN bazy, hash hasła). **Gitignored.** Wzór: `config.sample.php` |
| `public/index.html` | Powłoka SPA (brama logowania + nawigacja) |
| `public/app.js` | Cała logika UI: routing widoków, ekrany, zapis wyników, edycja składów |
| `public/api.js` | Klient `fetch` do API (obiekt `api`) |
| `public/schedule.js` | **Generator harmonogramu** (partner round-robin). Import w app.js i w testach |
| `public/ranking.js` | Liczenie rankingu turnieju + `validateScore` (walidacja braku remisu) |
| `public/stats.js` | **Statystyki globalne** (leaderboard, Elo, H2H, partnerzy, dni, kategorie, aliasy). Czysta logika, import w app.js i w testach |
| `public/styles.css` | Style mobile-first |
| `tampermonkey/pitole-collector.user.js` | **Opcjonalny** userscript — nasłuch pokoju HaxBall w przeglądarce, POST wyniku do `?r=ingest` |
| `schema.sqlite.sql` | Schemat bazy (SQLite — lokalnie i na produkcji) |
| `docs/algorithm.md` | Algorytm losowania + tabela liczby meczów + niezmienniki |
| `docs/data-model.md` | Model danych + wzór rankingu |
| `docs/deployment-ovh.md` | Runbook wdrożenia na OVH (krok po kroku) |
| `tests/*.test.js` | Testy Node dla generatora i rankingu |
| `dev-server.php` | Router **tylko do dev** (`php -S`), odtwarza układ produkcyjny |
| `docker-compose.yml` + `Dockerfile` | Dev w Dockerze: 1 kontener (PHP 8.2 + Apache + SQLite) — układ 1:1 jak OVH |
| `docker/config.docker.php` | Config dla kontenera (montowany jako `api/config.php`; SQLite, tylko dane dev) |
| `docker/init-db.php` | Init bazy SQLite ze schematu przy pierwszym starcie kontenera |
| `.github/workflows/deploy.yml` | **Auto-deploy**: push do `main` → testy → FTPS na OVH |
| `.github/deploy/` | Pliki `.htaccess` nakładane na produkcję przez CI (wymuszenie HTTPS, ochrona bazy) |

Podkatalogi mają własne `CLAUDE.md`: [`api/CLAUDE.md`](api/CLAUDE.md), [`public/CLAUDE.md`](public/CLAUDE.md).

## Reguły domenowe (niezmienniki — nie łam ich)

- **Format:** partner round-robin, dwa tryby:
  - **2v2** (4+ graczy) — każda para graczy gra razem (jako drużyna) raz. Gdy liczba par
    `C(n,2)` jest nieparzysta (n=6,7), dokładnie jedna para gra 2×.
  - **3v3** (dokładnie 6 graczy) — każda trójka gra razem raz: `C(6,3)/2 = 10` meczów,
    grają wszyscy (brak pauz).
- **Mecz:** 2 drużyny po 2 graczy (2v2, 4 różnych; reszta pauzuje) albo po 3 graczy
  (3v3, 6 różnych). Tryb wnioskowany z długości składu — bez kolumny na `tournaments`.
- **Punktacja:** wygrana = 3 pkt dla OBU graczy zwycięskiej drużyny, przegrana = 0.
- **Brak remisów** — `score_a != score_b` walidowane w JS (`validateScore`) i w PHP.
- **Ranking:** indywidualny. Sort: punkty ↓, bilans ↓, bramki zdobyte ↓.
- **Bilans gracza** = bramki zdobyte przez jego drużyny − stracone (ze wszystkich jego meczów).
- Generator i ranking liczą się **po stronie klienta**; backend to cienki CRUD + auth.

### Statystyki (moduł globalny — ponad pojedynczym turniejem)

- **Warstwa name-based:** mecze statystyk identyfikują graczy po **nicku** (haxball nie ma
  stałego id), osobno od id-owego rostera turniejowego. Most: nick == `name_snapshot` + aliasy.
- **Dwa źródła, jedna tabela:** (1) mecze na żywo z pokoju HaxBall (tamper → `?r=ingest`),
  (2) rzut meczów turniejowych z wynikiem. `statData()` łączy je i deduplikuje po auto-linku.
- **Auto-link (jak w haxstats):** przy ingeście backend szuka meczu **aktywnego** turnieju o
  tym samym składzie (nicki, aliasy, niezależnie od strony/kolejności) i wpisuje mu wynik
  (mapując czerwony/niebieski na drużynę A/B). Prawdziwy wynik nadpisuje ręczny; nie nadpisuje
  już zlinkowanego. Zapamiętany w `stat_matches.tournament_match_id` → zapobiega dublowaniu.
- **Ranking globalny liczy się po Elo**, nie po punktach — punktacja 3/wygraną żyje tylko w
  turniejach (`ranking.js`). Elo: baza 1000, K=32, odtwarzane chronologicznie; ocena drużyny =
  średnia + **handicap liczebności** `± 150·(rozmiar_red − rozmiar_blue)` (przy 3v2 wygrana
  słabszej liczebnie waży dużo, silniejszej — mało; 2v2 bez zmian).
- **Mecze liczone globalnie:** tylko gdy obie drużyny ≥2 graczy (`stats.counted()`) — bez 1v1,
  2v1, 3v1 — oraz **nie-treningowe** (`is_training=0`). Wykluczone są widoczne w historii
  (plakietki „nieliczony"/„treningowy"), poza obliczeniami.
- **Treningowy zamiast usuwania:** meczu na żywo się nie kasuje — oznacza `is_training`
  (PATCH `?r=stat_matches`). Odwracalne, dane zostają. Domyślnie mecze są oficjalne.
- Gole/asysty bywają 0 — kolektor z DOM nie zna strzelca (wysyła `null`).
- **Endpoint `?r=ingest` jest BEZ logowania** (tamper działa cross-origin na haxball.com).

## Uruchomienie lokalne

**Docker (zalecane):**
```bash
docker compose up          # -> http://localhost:8090, hasło dev: "pitole"
```
**Jeden kontener** = PHP 8.2 + Apache + **SQLite** — układ 1:1 jak na OVH (bez osobnego serwera
bazy). Plik bazy żyje w wolumenie `dbdata` (`/var/www/data/pitole.sqlite`); schemat
`schema.sqlite.sql` importuje się sam przy pierwszym starcie (`docker/init-db.php`). Kod
montowany z hosta (edycja bez rebuilda). Inny port: `APP_PORT=8123 docker compose up`.
Reset bazy: `docker compose down -v`. Config kontenera to `docker/config.docker.php`
(montowany jako `api/config.php` — lokalnego `api/config.php` nie nadpisuje i nie używa).

**Po pullu ze zmianą schematu:** nowe **kolumny** dokłada się same (`Repo::migrate` przy
pierwszym połączeniu). Nowe **tabele** wymagają odświeżenia bazy dev: `docker compose down -v`
(kasuje dane dev, baza powstaje od nowa ze `schema.sqlite.sql`). Nie ma pełnego systemu
migracji — świadoma decyzja (projekt hobbystyczny).

**Bez Dockera** — PHP 8 (np. XAMPP: `/c/xampp/php/php.exe`) + SQLite:
```bash
# 1. Baza SQLite + config
php -r '$p=new PDO("sqlite:api/pitole.sqlite");$p->exec(file_get_contents("schema.sqlite.sql"));'
cp config.sample.php api/config.php          # ustaw ścieżkę sqlite + hash hasła (patrz niżej)
php -r "echo password_hash('pitole', PASSWORD_DEFAULT), PHP_EOL;"   # wklej do config.php

# 2. Serwer dev (odtwarza układ OVH: / = public/, /api = api/)
php -S 127.0.0.1:8099 dev-server.php
#    -> http://127.0.0.1:8099/   (UWAGA: użyj 127.0.0.1, nie "localhost",
#       bo "localhost" bywa zajęty przez inny lokalny serwer na ::1)
```

**Testy logiki:**
```bash
node --test
```

Uwaga dot. testów w przeglądarce w tym środowisku: syntetyczne zdarzenia bywają zawodne —
przy weryfikacji UI steruj przez konsolę (`element.click()`, `dispatchEvent`) i czytaj DOM.

## Wdrożenie

Produkcja: **https://pitole.pl** na **darmowym hostingu OVH 100M** (PHP 8.2, SQLite).
Pełny runbook: [`docs/deployment-ovh.md`](docs/deployment-ovh.md).

- **Pierwsze / ręczne wdrożenie:** baza SQLite ze `schema.sqlite.sql` → `api/config.php`
  (DSN sqlite + hash hasła) → wgraj zawartość `public/` do web roota (`www/`) i `api/` obok
  (`www/api/`) → włącz SSL (Let's Encrypt).
- **Aktualizacje:** automatycznie — push do `main` odpala
  [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) (testy + FTPS sync na OVH).
  Sync **nie rusza** `config.php` ani `pitole.sqlite` na serwerze.
- **Zmiany schematu** nanoś ręcznie (brak migracji) — patrz sekcja o Dockerze wyżej i runbook.

## Konwencje

- Kod i UI **po polsku** (komentarze, komunikaty, etykiety).
- Cały SQL trzymaj w `api/db.php` (klasa `Repo`). Nie rozsiewaj zapytań po `index.php`.
- Nazwy graczy zawsze escapuj przy wstawianiu do HTML (`esc()` w `app.js`).
- Zmiany w regułach punktacji/algorytmie → zaktualizuj też `docs/` i testy.
