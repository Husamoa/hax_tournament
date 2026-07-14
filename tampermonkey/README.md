# Pitole Collector (Tampermonkey) — opcjonalny nasłuch wyników

Userscript, który **nasłuchuje pokoju HaxBall w Twojej przeglądarce** i wysyła każdy zakończony
mecz do Pitole. Wynik trafia do globalnych statystyk, a jeśli pasuje do meczu **aktywnego
turnieju** (te same nicki co skład) — backend **automatycznie wpisuje wynik** temu meczowi.

To jest opcja. Bez niego wyniki wpisujesz ręcznie w zakładce Turniej — one też liczą się do
statystyk.

## Instalacja

1. Zainstaluj rozszerzenie [Tampermonkey](https://www.tampermonkey.net/) (Chrome/Firefox/Edge).
2. Otwórz `pitole-collector.user.js` → Tampermonkey zaproponuje instalację. Albo: panel
   Tampermonkey → *Utwórz nowy skrypt* → wklej zawartość pliku → zapisz.
3. **Ustaw adres Pitole** na górze skryptu (`const BASE = ...`):
   - lokalnie: `http://127.0.0.1:8099`
   - produkcja: `https://pitole.pl`
   Jeśli używasz innej domeny, dopisz ją także w nagłówku `// @connect`.

## Jak działa

- Wchodzi na `*.haxball.com`, obserwuje **log pokoju** (linie „Game started by…”,
  „Game stopped by…”, „Red/Blue team won”).
- Skład drużyn czyta z panelu (widoczny gdy gra stoi), wynik z tablicy, czas z zegara.
- Mecz **liczy się tylko** gdy dojdzie do zwycięstwa. Zatrzymany przed końcem = anulowany.
- Po zwycięstwie wysyła `POST ?r=ingest` z payloadem
  `{room, started_at, ended_at, duration_sec, red_score, blue_score, winner, red[], blue[], goals[]}`.

## Ograniczenia

- **Strzelca/asysty nie da się odczytać z DOM przeglądarki** — gole wysyłane bez strzelca
  (`scorer: null`). Dlatego kolumny „G/A” (gole/asysty) w rankingu bywają zerowe. Reszta
  (mecze, wygrane, bilans, Elo, head-to-head) liczy się normalnie.
- Endpoint `?r=ingest` jest **bez logowania** (userscript działa cross-origin, nie ma sesji
  PHP). Dla prywatnego użytku OK; nie publikuj adresu jeśli to problem.
- Auto-link działa gdy nicki w HaxBall = nazwy graczy w turnieju. Rozjazdy nicków scalisz
  w zakładce **Statystyki → Aliasy**.
