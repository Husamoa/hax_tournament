# Model danych

Schemat: [`schema.sqlite.sql`](../schema.sqlite.sql) (SQLite — ta sama baza lokalnie i na produkcji).
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

### `matches` — mecze 2v2/3v3 + wyniki
| Kolumna | Typ | Opis |
|---|---|---|
| `id` | PK | |
| `tournament_id` | FK | (indeks) |
| `match_no` | INT | kolejność w harmonogramie |
| `a1_id`, `a2_id` | INT | drużyna A |
| `a3_id` | INT NULL | drużyna A, gracz 3 — **NULL = tryb 2v2** |
| `b1_id`, `b2_id` | INT | drużyna B |
| `b3_id` | INT NULL | drużyna B, gracz 3 — **NULL = tryb 2v2** |
| `score_a`, `score_b` | INT NULL | NULL = mecz jeszcze nierozegrany |

**Tryb** (2v2/3v3) nie jest przechowywany — wnioskowany z `a3_id IS NOT NULL` (backend) /
długości `teamA` (frontend). Brak kolumny trybu na `tournaments`.

**Pauzujący** = uczestnicy turnieju minus grający → **wyliczane** (brak tabeli),
w JS przez `sittingOut()`. W 3v3 (dokładnie 6 graczy) nikt nie pauzuje.

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
`tournament_match_id`) klient liczy: leaderboard, **Elo**, head-to-head, partnerów, dni,
kategorie, podsumowanie. Aliasy resolvowane przez `resolveMatches()` przed liczeniem.

**Globalny ranking = po Elo** (nie po punktach — punktacja 3/wygraną żyje tylko w turniejach,
`ranking.js`). Kolumny tabeli: Elo, M, W, P, BZ, BS, +/− (gole/asysty indywidualne są w
profilu gracza). Kolumny sortowalne klikiem nagłówka.

**Elo** — baza 1000, K=32, chronologicznie. Ocena drużyny = średnia ocen graczy + **handicap
liczebności**: `± ELO_ADV·(rozmiar_red − rozmiar_blue)`, `ELO_ADV=150`. Skutek: przy 3v2
faworytem jest liczniejsza drużyna, więc jej wygrana rusza Elo słabo, a wygrana słabszej
liczebnie — mocno. Dla 2v2 handicap = 0 (bez zmian).

**Mecze liczone (`counted()`):** tylko gdy obie drużyny mają ≥2 graczy — bez 1v1, 2v1, 3v1.
Wykluczone mecze są widoczne w historii (plakietka „nieliczony"), ale poza wszystkimi
obliczeniami globalnymi.

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
              teamA:[id,id(,id)], teamB:[id,id(,id)],   // 3. gracz tylko w trybie 3v3
              scoreA, scoreB }]            // zmapowane z kolumn a1..b3 / score_*
}
```
