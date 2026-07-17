# CLAUDE.md — backend (`api/`)

Cienkie API JSON w PHP 8. Cały dostęp do bazy w jednym miejscu.

## Pliki

- **`db.php`** — jedyna warstwa danych:
  - `DB::pdo()` — leniwe połączenie PDO wg `config.php` (MySQL lub SQLite, `ERRMODE_EXCEPTION`).
  - `Repo` — statyczne metody z **całym SQL** aplikacji. Nowe zapytania dodawaj TUTAJ.
- **`index.php`** — router. Parsuje `?r=<zasób>` + metodę HTTP, woła `Repo`, zwraca JSON.
- **`config.php`** — sekrety (DSN, `password_hash`). Gitignored. Wzór: `../config.sample.php`.

## Routing (query-string, bez rewrite/.htaccess)

| Metoda | `?r=` | Body / params | Działanie |
|---|---|---|---|
| GET | `session` | — | `{authed}` |
| POST | `login` | `{password}` | logowanie (sesja) |
| POST | `logout` | — | wylogowanie |
| GET | `players` | — | roster (aktywni) |
| POST | `players` | `{name, is_guest}` | dodaj gracza (409 gdy duplikat) |
| PATCH | `players` | `&id=` | archiwizuj gracza |
| GET | `tournaments` | opc. `&id=` | lista lub szczegóły |
| POST | `tournaments` | `{name?, playerIds[], matches[], status?}` | utwórz (transakcja) |
| DELETE | `tournaments` | `&id=` | usuń (CASCADE) |
| POST | `finish` | `&id=` + `{winner_player_id}` | zakończ turniej |
| POST | `reopen` | `&id=` | wznów zakończony turniej (→ active, wyniki zostają); 409 gdy inny jest aktywny |
| PATCH | `matches` | `&id=` + `{score_a, score_b}` | zapis wyniku (null,null = wyczyść) |
| POST | `ingest` | `{room,red[],blue[],red_score,blue_score,winner,goals[]}` | **BEZ auth** — mecz z HaxBall (tamper) + auto-link do turnieju |
| GET | `stats` | — | surowe mecze (na żywo + rzut turniejowy, dedup) + aliasy; klient liczy resztę |
| GET/POST/DELETE | `aliases` | `{alias,canonical}` / `&alias=` | scalanie nicków |
| POST | `stat_matches` | `{red[],blue[],red_score,blue_score,started_at?}` | ręczne dodanie meczu (name-based, przez `ingestStatMatch` → auto-link); `room=Repo::MANUAL_ROOM` |
| PUT | `stat_matches` | `&id=` + `{red[],blue[],red_score,blue_score,started_at?}` | edycja meczu — **tylko ręczny** (`updateManualMatch`); inaczej 403 |
| PATCH | `stat_matches` | `&id=` + `{is_training}` | oznacz mecz na żywo/ręczny treningowy (1) / oficjalny (0) — odwracalne, bez usuwania |
| DELETE | `stat_matches` | `&id=` | usuń mecz — **tylko ręczny** (`deleteStatMatch`, CASCADE); inaczej 403 |

Wszystko poza `session`/`login`/`ingest` wymaga zalogowania (`require_auth()`).

## Statystyki (Repo)

- `ingestStatMatch($p)` — zapis meczu (`stat_matches` + `stat_match_players` + `stat_goals`)
  w transakcji, potem `autoLinkActiveTournament()` (dopasowanie składu po nickach/aliasach →
  wpis wyniku do `matches` + zapamiętanie `tournament_match_id`).
- `statData()` — łączy mecze na żywo z rzutem meczów turniejowych z wynikiem, pomijając te już
  reprezentowane przez mecz na żywo (dedup po `tournament_match_id`). Zwraca kształt name-based.
  `source` meczu z `stat_matches`: `manual` gdy `room === Repo::MANUAL_ROOM` (dodany ręcznie),
  inaczej `live`.
- **Ręczny mecz** (`POST ?r=stat_matches`): `manual_match_payload()` (w `index.php`) waliduje
  składy (1–3/drużynę, gracze różni, case-insensitive), wynik (całkowity ≥ 0, bez remisu) i czas
  (`started_at` unix, clamp do [2000, teraz+1d]); potem `ingestStatMatch` z `room=Repo::MANUAL_ROOM`
  — więc korzysta z tego samego auto-linku do aktywnego turnieju (z `auto_fill=1`) co mecze z pokoju.
  Gole zawsze puste.
- **Edycja/usuwanie ręcznego meczu:** `updateManualMatch($id,$p)` (PUT) podmienia skład + wynik +
  czas (świadomie NIE rusza `tournament_match_id`/auto-linku — to korekta danych). `deleteStatMatch($id)`
  (DELETE) kasuje wiersz (CASCADE zdejmuje `stat_match_players`/`stat_goals`). Oba chronione w routerze
  przez `statMatchRoom($id) === Repo::MANUAL_ROOM` (na żywo/turniejowe → 403). Mecze z pokoju usuwa się
  „miękko” flagą `is_training`.
- Aliasy: `aliasMap()`/`resolve()` (płaskie mapowanie, spłaszczanie łańcucha), `setAlias`/`deleteAlias`.

## Zasady

- **Walidacja serwerowa wyniku** (`matches` PATCH): liczby całkowite ≥ 0, `score_a != score_b`
  (remis → 400). Nie ufaj tylko frontendowi.
- **Autoryzacja:** wspólne hasło ekipy porównywane `password_verify` z `config['password_hash']`;
  po sukcesie `session_regenerate_id(true)` + `$_SESSION['authed']=true`. Cookie `httponly`,
  `samesite=Lax`, `secure` pod HTTPS.
- **Długa sesja (OVH):** darmowy hosting kasował sesję po ~24 min (`gc_maxlifetime`) i sprzątał
  wspólny katalog sesji cronem — mimo długiego cookie. Dlatego `index.php`: własny
  `session_save_path` w `api/sessions/` (host go nie rusza; chroniony `.htaccess` + gitignored,
  tworzony w runtime; fallback do domyślnego gdy niezapisywalny), `gc_maxlifetime`+cookie = 1 rok,
  a każde żądanie zalogowanej sesji odświeża cookie i `mtime` pliku (ślizgowo → z użyciem sesja
  nie wygasa). Uwaga: zmiana `save_path` jednorazowo wylogowuje istniejące sesje po wdrożeniu.
- **Transakcje:** `Repo::createTournament` wstawia nagłówek + uczestników + mecze atomowo.
- **Migawka nazw:** `tournament_players.name_snapshot` — tabela turnieju jest odporna na
  późniejszą zmianę nazwy gracza w rosterze.
- **Kształt danych dla frontu:** `getTournament` zwraca `matches` jako
  `{id, match_no, teamA:[id,id(,id)], teamB:[id,id(,id)], scoreA, scoreB}` (już zmapowane
  z kolumn DB; 3. gracz tylko w trybie 3v3 — kolumny `a3_id`/`b3_id` NULL w 2v2).

## Zgodność

Kod celuje w PHP 8.0+ (`str_starts_with`, typy). Na OVH ustaw PHP 8.x w Managerze.
Wymagane rozszerzenia: `pdo_sqlite` (produkcja i dev), `mbstring`. (Gdyby MySQL — `pdo_mysql`.)
