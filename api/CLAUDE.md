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
| PATCH | `matches` | `&id=` + `{score_a, score_b}` | zapis wyniku (null,null = wyczyść) |

Wszystko poza `session`/`login` wymaga zalogowania (`require_auth()`).

## Zasady

- **Walidacja serwerowa wyniku** (`matches` PATCH): liczby całkowite ≥ 0, `score_a != score_b`
  (remis → 400). Nie ufaj tylko frontendowi.
- **Autoryzacja:** wspólne hasło ekipy porównywane `password_verify` z `config['password_hash']`;
  po sukcesie `session_regenerate_id(true)` + `$_SESSION['authed']=true`. Cookie `httponly`,
  `samesite=Lax`, `secure` pod HTTPS.
- **Transakcje:** `Repo::createTournament` wstawia nagłówek + uczestników + mecze atomowo.
- **Migawka nazw:** `tournament_players.name_snapshot` — tabela turnieju jest odporna na
  późniejszą zmianę nazwy gracza w rosterze.
- **Kształt danych dla frontu:** `getTournament` zwraca `matches` jako
  `{id, match_no, teamA:[id,id], teamB:[id,id], scoreA, scoreB}` (już zmapowane z kolumn DB).

## Zgodność

Kod celuje w PHP 8.0+ (`str_starts_with`, typy). Na OVH ustaw PHP 8.x w Managerze.
Wymagane rozszerzenia: `pdo_mysql` (produkcja) / `pdo_sqlite` (dev), `mbstring`.
