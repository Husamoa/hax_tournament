# CLAUDE.md — frontend (`public/`)

SPA bez frameworka i bez build-stepu. Moduły ES ładowane bezpośrednio przez przeglądarkę.

## Pliki

- **`index.html`** — powłoka: brama logowania (`#login`) + aplikacja (`#app`) z nagłówkiem,
  zakładkami i kontenerem `#view`. Ładuje `app.js` jako `type="module"`.
- **`app.js`** — cała logika UI. Jeden obiekt `state`, funkcje `render*` renderują widok do
  `#view` przez `innerHTML`, po czym podpinają listenery. Import: `api`, `generateSchedule`,
  `sittingOut`, `expectedMatchCount`, `computeRanking`, `validateScore`.
- **`api.js`** — obiekt `api` z metodami `fetch` do `api/index.php`. Ścieżka względna działa
  lokalnie i na OVH.
- **`schedule.js`** — generator harmonogramu (opis: `../docs/algorithm.md`). Czysta logika,
  importowana też w testach Node.
- **`ranking.js`** — `computeRanking` + `validateScore`. Czysta logika, testowana w Node.
- **`stats.js`** — statystyki globalne (leaderboard, `eloRatings`, `headToHead`, `teammates`,
  `days`, `categories`, `summary`, `playerDetail`, `resolveMatches`/`aliasMap`). Czysta logika,
  operuje na płaskiej liście meczów z `?r=stats`. Testowana w Node.
- **`styles.css`** — mobile-first, zmienne CSS w `:root`, akcent „boiskowy" zielony.

## Model stanu (`state` w app.js)

- `authed`, `tab` (`turniej`|`historia`|`gracze`)
- `players` — roster; `tournaments` — podsumowania
- `active` — pełny aktywny turniej lub `null`
- `draft` — tworzony turniej przed zapisem `{name, seed, playerIds, matches}`
- `setup` — ekran wyboru graczy `{name, selected:Set}`
- `subtab` (`mecze`|`tabela`), `editing` (edycja składów), `historyDetail`
- **statystyki:** `statsRaw` (surowe z API), `statsMatches` (po aliasach), `statsSub`
  (`ranking`|`mecze`|`gracz`|`h2h`|`dni`|`kategorie`|`aliasy`), `statsCat`/`statsDay` (filtry),
  `statsPlayer`, `statsExpanded` (rozwinięte mecze), `h2hA`/`h2hB`. Dane ładowane leniwie przy
  wejściu w zakładkę (`loadStats`), przycisk „↻ Odśwież”. Nazwy graczy przez `esc()`.

## Przepływ ekranów

```
Login → Turniej:
  active? → widok aktywny (subtaby Mecze / Tabela na żywo) → „Zakończ"
  draft?  → podgląd harmonogramu (Przelosuj / Edytuj składy / Rozpocznij)
  else    → wybór graczy → „Generuj harmonogram" → draft
Historia → lista zakończonych → szczegóły (tabela końcowa + mecze)
Gracze   → roster: dodaj (+ gość) / usuń (archiwizacja)
```

## Ważne szczegóły implementacyjne

- **Zapis wyniku na żywo:** inputy w widoku Mecze mają listenery `change`; przy dwóch
  poprawnych liczbach → `validateScore` → `api.setScore` (PATCH) → aktualizacja
  `state.active.matches` w miejscu + „✓ zapisano". Lista NIE jest przerenderowywana przy
  wpisywaniu, żeby nie tracić fokusu.
- **Ranking na żywo:** liczony z `state.active.matches` przy każdym wejściu w „Tabela”.
- **Edycja składów (draft):** zmiana slotu przez `<select>`; `onSlotChange` utrzymuje 4
  różnych graczy w meczu (swap w obrębie meczu albo wejście z ławki).
- **Przelosuj:** nowy `seed` → `generateSchedule` na tych samych graczach.
- **Bezpieczeństwo XSS:** wszystkie nazwy graczy przez `esc()` przed wstawieniem do HTML.
- **Walidacja jest podwójna:** klient (`validateScore`) + serwer (PATCH `matches`).

## Testowanie UI w tym środowisku

Syntetyczne zdarzenia harnessu bywają zawodne (klik/typing/screenshot potrafią się zaciąć).
Do weryfikacji steruj przez konsolę (`el.click()`, `dispatchEvent(new Event('change'))`)
i odczytuj `#view`/DOM oraz network. Logika przy takim sterowaniu działa niezawodnie.
