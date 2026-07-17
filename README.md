# Pitole — turnieje HaxBall 2v2

Aplikacja webowa dla ekipy **Pitole** do generowania i prowadzenia turniejów w grę
HaxBall w formacie 2v2 z losowanymi składami i **indywidualnym** rankingiem graczy.

- **Format:** partner round-robin — każda para graczy gra razem (jako drużyna) raz.
- **Punktacja:** wygrana = 3 pkt dla obu graczy, przegrana = 0. Bez remisów.
- **Ranking:** indywidualny, na żywo. Sort: punkty → bilans → bramki zdobyte.
- **Dane:** wspólna baza (każdy widzi to samo) + historia zakończonych turniejów.
- **Statystyki (globalne):** ranking ponad turniejami, Elo, head-to-head, partnerzy, dni,
  kategorie, scalanie nicków. Zasilane wynikami z turniejów **oraz** opcjonalnym nasłuchem
  pokoju HaxBall (userscript Tampermonkey → auto-wpis wyniku do aktywnego turnieju).

## Stack

PHP 8 + SQLite (cienkie API JSON) + frontend SPA (vanilla JS, moduły ES) — **bez
build-stepu**. Docelowy hosting: OVH, domena `pitole.pl`.

## Struktura

```
api/       backend PHP (JSON) — db.php = jedyna warstwa dostępu do bazy
public/    frontend SPA (index.html + moduły JS + CSS)
docs/      algorytm, model danych, runbook wdrożenia OVH
schema.sqlite.sql      schemat bazy (SQLite — lokalnie i na produkcji)
config.sample.php      szablon konfiguracji → skopiuj do api/config.php
tests/       testy Node dla generatora, rankingu i statystyk
tampermonkey/  opcjonalny userscript do nasłuchu wyników z HaxBall
```

## Nasłuch wyników (opcjonalny)

Userscript [`tampermonkey/pitole-collector.user.js`](tampermonkey/pitole-collector.user.js)
nasłuchuje pokoju HaxBall w przeglądarce i wysyła zakończone mecze do Pitole. Wynik trafia do
globalnych statystyk, a gdy skład pasuje do meczu aktywnego turnieju — wpisywany jest
automatycznie. Instalacja i konfiguracja: [`tampermonkey/README.md`](tampermonkey/README.md).

## Development lokalny

### Docker (zalecane) — jedno polecenie

```bash
docker compose up
```

Wstaje aplikacja pod **http://localhost:8090** (hasło dev: `pitole`) na
**PHP 8.2 + Apache + SQLite — dokładnie jak na produkcji OVH** (bez osobnego serwera bazy;
schemat SQLite importuje się sam przy pierwszym starcie). Kod montowany z hosta — edytujesz
plik, odświeżasz przeglądarkę.

- inny port: `APP_PORT=8123 docker compose up`
- reset bazy: `docker compose down -v`

### Bez Dockera (PHP + SQLite)

```bash
# 1. Baza SQLite + config
php -r '$p=new PDO("sqlite:api/pitole.sqlite");$p->exec(file_get_contents("schema.sqlite.sql"));'
cp config.sample.php api/config.php      # ustaw ścieżkę sqlite + password_hash

# 2. Serwer dev (router odtwarza układ OVH: / = public/, /api = api/)
php -S 127.0.0.1:8099 dev-server.php
```

### Testy logiki (wymaga Node)

```bash
npm test
```

## Dla AI / nowych osób

Zacznij od [`CLAUDE.md`](CLAUDE.md) — mapa projektu, reguły domenowe i wskaźniki do
`docs/` oraz plików `CLAUDE.md` w `api/` i `public/`.

## Wdrożenie na OVH

Krok po kroku: [`docs/deployment-ovh.md`](docs/deployment-ovh.md).
