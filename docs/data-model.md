# Model danych

Schemat: [`schema.sqlite.sql`](../schema.sqlite.sql) (SQLite — produkcja i dev), [`schema.sql`](../schema.sql) (MySQL — opcjonalnie, płatny plan).
Dostęp: wyłącznie przez `Repo` w [`api/db.php`](../api/db.php).

## Tabele

### `players` — globalny roster ekipy
| Kolumna | Typ | Opis |
|---|---|---|
| `id` | PK | |
| `name` | VARCHAR UNIQUE | imię/nick |
| `is_guest` | bool | 1 = gość spoza stałej ekipy |
| `archived` | bool | 1 = ukryty na liście wyboru (miękkie usunięcie) |
| `created_at` | DATETIME | |

Gracze są wielokrotnego użytku między turniejami. „Usunięcie" = `archived = 1`.

### `tournaments`
| Kolumna | Typ | Opis |
|---|---|---|
| `id` | PK | |
| `name` | VARCHAR NULL | domyślnie generowana z daty w UI |
| `status` | enum | `draft` / `active` / `finished` |
| `created_at` | DATETIME | |
| `finished_at` | DATETIME NULL | ustawiane przy zakończeniu |
| `winner_player_id` | FK→players NULL | gracz nr 1 tabeli końcowej |

Założenie: jeden turniej `active` naraz.

### `tournament_players` — uczestnicy turnieju (migawka)
| Kolumna | Typ | Opis |
|---|---|---|
| `tournament_id` | FK | (PK złożony) |
| `player_id` | FK | (PK złożony) |
| `name_snapshot` | VARCHAR | nazwa gracza z chwili utworzenia turnieju |

`name_snapshot` sprawia, że tabela archiwalnego turnieju jest odporna na późniejszą zmianę
nazwy w rosterze.

### `matches` — mecze 2v2 + wyniki
| Kolumna | Typ | Opis |
|---|---|---|
| `id` | PK | |
| `tournament_id` | FK | (indeks) |
| `match_no` | INT | kolejność w harmonogramie |
| `a1_id`, `a2_id` | FK→players | drużyna A |
| `b1_id`, `b2_id` | FK→players | drużyna B |
| `score_a`, `score_b` | INT NULL | NULL = mecz jeszcze nierozegrany |

**Pauzujący** = uczestnicy turnieju minus 4 gracze meczu → **wyliczane** (brak tabeli),
w JS przez `sittingOut()`.

`ON DELETE CASCADE`: usunięcie turnieju kasuje jego `tournament_players` i `matches`.

## Ranking (wyliczany, nie przechowywany)

Liczony z meczów z ustawionym wynikiem, w [`public/ranking.js`](../public/ranking.js) → `computeRanking`.
Dla każdego gracza:

- **Rozegrane (M)** = liczba meczów, w których wystąpił
- **Wygrane (W) / Przegrane (P)** = wg tego, po której stronie był i który wynik wyższy
- **Punkty** = `3 × W` (wygrana = 3 dla obu graczy drużyny; przegrana = 0; brak remisów)
- **Bramki zdobyte (BZ)** = suma bramek drużyn gracza; **stracone (BS)** = suma bramek przeciwników
- **Bilans (+/−)** = BZ − BS

**Sortowanie:** Punkty ↓ → Bilans ↓ → Bramki zdobyte ↓ (na końcu alfabetycznie, dla determinizmu).

## Statystyki (moduł globalny)

Warstwa **name-based** (gracze po nicku — HaxBall nie ma stałego id). Osobna od id-owego
rostera turniejowego; most między nimi to nick == `name_snapshot` + tabela `aliases`.

### `stat_matches` — zakończony mecz z pokoju HaxBall
| Kolumna | Typ | Opis |
|---|---|---|
| `id` | PK | |
| `room` | VARCHAR | id pokoju albo `manual` |
| `started_at`, `ended_at`, `duration_sec` | DOUBLE | czas (unix, sekundy) |
| `red_score`, `blue_score` | INT | wynik |
| `winner` | VARCHAR | `red` / `blue` (HaxBall zawsze ma zwycięzcę) |
| `tournament_match_id` | FK→matches NULL | auto-link do meczu turnieju (dedup) |
| `created_at` | DATETIME | |

### `stat_match_players` — skład (migawka z `onGameStart`)
`id` PK, `match_id` FK→stat_matches (CASCADE), `name`, `team` (`red`/`blue`).

### `stat_goals` — gole
`id` PK, `match_id` FK (CASCADE), `time`, `team`, `scorer` NULL, `assist` NULL, `own_goal` bool.
`scorer`/`assist` bywają NULL — kolektor z DOM nie zna strzelca.

### `aliases` — scalanie nicków
`alias` PK (stary/inny nick) → `canonical` (aktualny). Odwracalne, nie zmienia zapisów meczów.

### Wyliczane w kliencie ([`public/stats.js`](../public/stats.js))

Z `Repo::statData()` (mecze na żywo + rzut meczów turniejowych z wynikiem, dedup po
`tournament_match_id`) klient liczy: leaderboard (punktacja Pitole 3/0 + bilans + BZ/BS + gole/
asysty), **Elo** (baza 1000, K=32, chronologicznie), head-to-head, partnerów, dni, kategorie,
podsumowanie. Aliasy resolvowane przez `resolveMatches()` przed liczeniem.

### Auto-link do turnieju (`ingest`)

Nowy mecz na żywo o składzie równym meczowi **aktywnego** turnieju (nicki, aliasy, niezależnie
od strony/kolejności) → backend wpisuje wynik do `matches` (mapując czerwony/niebieski na A/B)
i zapisuje `tournament_match_id`. Prawdziwy wynik nadpisuje ręczny; nie nadpisuje już
zlinkowanego. To zapobiega dublowaniu w statystykach.

## Kontrakt danych dla frontendu

`Repo::getTournament(id)` zwraca:
```
{
  id, name, status, created_at, finished_at, winner_player_id,
  players: [{ id, name }],                 // z name_snapshot
  matches: [{ id, match_no,
              teamA:[id,id], teamB:[id,id],
              scoreA, scoreB }]            // zmapowane z kolumn a1..b2 / score_*
}
```
