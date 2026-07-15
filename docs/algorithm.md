# Algorytm losowania harmonogramu (partner round-robin)

Implementacja: [`public/schedule.js`](../public/schedule.js). Testy: [`tests/schedule.test.js`](../tests/schedule.test.js).

Dwa tryby: **2v2** (`generateSchedule`, 4+ graczy) i **3v3** (`generateSchedule3v3`,
dokładnie 6 graczy — sekcja na końcu).

## Cel (2v2)

Każda **para** graczy ma zagrać razem (jako drużyna) możliwie dokładnie raz. Jeden mecz to
**2 rozłączne pary** (4 różnych graczy); pozostali pauzują. Pauzy rozłożone możliwie równo.

## Matematyka

Liczba par graczy: `C(n,2) = n·(n−1)/2`. Każdy mecz zużywa 2 pary, więc
minimalna liczba meczów = `ceil(C(n,2)/2)`.

- Gdy `C(n,2)` **parzyste** → idealne pokrycie: każda para dokładnie 1×, meczów `= C(n,2)/2`.
- Gdy `C(n,2)` **nieparzyste** → nie da się idealnie sparować. Dokładamy 1 mecz i **jedna
  para gra 2×** (reszta 1×), meczów `= (C(n,2)+1)/2`.

Formalnie: szukamy **skojarzenia doskonałego w grafie Kneshera K(n,2)** (wierzchołki = pary
graczy, krawędź = pary rozłączne). Dla parzystego `C(n,2)` i `n ≥ 4` zawsze istnieje
(przypadek n=5 to graf Petersena — skojarzenie doskonałe posiada).

## Kroki (w `generateSchedule`)

1. Zbuduj listę wszystkich par (krawędzie `[i,j]`).
2. Jeśli liczba par nieparzysta → dołóż jedną zdublowaną parę (dopełnienie do parzystej;
   próbujemy różne pary, aż skojarzenie się powiedzie).
3. **Skojarz pary w mecze** — backtracking z heurystyką MRV („najbardziej ograniczony
   wierzchołek najpierw": bierz niesparowaną parę o najmniejszej liczbie rozłącznych
   partnerów) + losowa kolejność kandydatów. Dla n ≤ ~12 natychmiastowe.
4. **Kolejność meczów** pod równe pauzy: zachłannie wybieramy mecz, którego gracze pauzowali
   dotąd najczęściej (spread pauz w czasie).
5. **Seed** (`mulberry32`) → ten sam seed = ten sam harmonogram; „Przelosuj" = nowy seed.

## Niezmienniki (weryfikowane testami)

- W każdym meczu 4 **różnych** graczy (drużyny bez wspólnego gracza).
- Każda para pokryta ≥ 1× (i ≤ 2×).
- Liczba par pokrytych 2×: **0** gdy `C(n,2)` parzyste, **dokładnie 1** gdy nieparzyste.
- Liczba meczów = `ceil(C(n,2)/2)`.
- Balans: `max(gry) − min(gry) ≤ 1` (i analogicznie pauzy).

## Tabela liczby meczów (potwierdzona testami dla wielu seedów)

| n | Pary `C(n,2)` | Parzystość | Mecze | Pauzy/gracz | Gry/gracz | Uwagi |
|---|---|---|---|---|---|---|
| 4 | 6  | parzyste    | **3**  | 0        | 3        | każda para 1×, brak pauz (grają wszyscy) |
| 5 | 10 | parzyste    | **5**  | 1        | 4        | każda para 1×, idealnie zbalansowane |
| 6 | 15 | NIEparzyste | **8**  | 2 lub 3  | 5 lub 6  | 14 par 1×, 1 para 2× |
| 7 | 21 | NIEparzyste | **11** | 4 lub 5  | 6 lub 7  | 20 par 1×, 1 para 2× |
| 8 | 28 | parzyste    | **14** | 7        | 7        | każda para 1×, idealnie zbalansowane |

Generator działa też dla większych `n` (przetestowane 9–12).

## Tryb 3v3 (`generateSchedule3v3`) — dokładnie 6 graczy

Ta sama zasada co 2v2, ale dla trójek: **każda trójka gra razem (jako drużyna) dokładnie raz**.

**Matematyka:** trójek jest `C(6,3) = 20`. Przy 6 graczach drużyny meczu są komplementarne
(trójka + jej dopełnienie), więc podziałów na dwie trójki jest `20/2 = 10` → **10 meczów**,
w każdym grają **wszyscy** (zero pauz — dlatego nie ma tu heurystyki rozkładania pauz).

**Kroki:**
1. Kanonizacja podziału: enumeruj pary `{i,j}` z indeksów 1..5 → drużyna `[0,i,j]` +
   dopełnienie. To daje dokładnie `C(5,2) = 10` unikalnych podziałów, a każda z 20 trójek
   występuje dokładnie raz (10 kanonicznych z graczem 0 + ich 10 dopełnień).
2. Seedowany shuffle kolejności meczów + losowa strona (A/B) + kolejność nazwisk w drużynie
   (ten sam `mulberry32`; „Przelosuj" = nowy seed).

**Niezmienniki (weryfikowane testami):** 10 meczów; każdy mecz = 6 różnych graczy (3+3,
`sittingOut = []`); zbiór trójek ze wszystkich meczów ma moc 20 ⇒ każda trójka dokładnie raz;
determinizm po seedzie; `n ≠ 6` → błąd.

Inne `n` dla 3v3 świadomie nieobsługiwane (np. n=7 wymagałby pauz i innej kombinatoryki).

## Poza zakresem (możliwe rozszerzenie)

Balansowanie **przeciwników** (kto z kim gra przeciw komu). Wymóg to tylko: każda para
(2v2) / trójka (3v3) partneruje ≥1× + równe pauzy. Dobór przeciwników jest pochodną skojarzenia.

## Jak przetestować

```bash
node --test                      # wszystkie testy
node --test tests/schedule.test.js
```
Test wypisuje `Liczba meczów wg n: {"4":3,"5":5,"6":8,"7":11,"8":14}`.
