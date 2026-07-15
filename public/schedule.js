// Generatory harmonogramów turniejów HaxBall — "partner round-robin".
//
// Tryb 2v2 (generateSchedule): każda para graczy gra razem (jako drużyna) możliwie
// dokładnie raz. Mecz = 2 rozłączne pary (4 różnych graczy). Pozostali pauzują.
//
// Matematyka 2v2: liczba par to C(n,2). Każdy mecz zużywa 2 pary.
//   - C(n,2) parzyste  -> każda para dokładnie 1x, meczów = C(n,2)/2
//   - C(n,2) nieparzyste -> +1 mecz, jedna para 2x, meczów = (C(n,2)+1)/2
// Formalnie: skojarzenie doskonałe w grafie Kneshera K(n,2)
// (wierzchołki = pary graczy, krawędź = pary rozłączne).
//
// Tryb 3v3 (generateSchedule3v3): DOKŁADNIE 6 graczy, każda trójka gra razem raz.
// C(6,3)=20 trójek -> 10 komplementarnych podziałów -> 10 meczów, grają wszyscy (brak pauz).
//
// Moduł jest importowany zarówno w przeglądarce (public/app.js) jak i w testach Node
// (tests/schedule.test.js) — czysta logika, bez zależności od DOM.

// --- Deterministyczny RNG (mulberry32): ten sam seed => ten sam harmonogram ---
export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

// Dwie pary (krawędzie) są rozłączne, gdy nie mają wspólnego gracza.
function disjoint(e, f) {
  return e[0] !== f[0] && e[0] !== f[1] && e[1] !== f[0] && e[1] !== f[1];
}

// Skojarz listę par (krawędzi) w mecze po 2 rozłączne pary.
// edges: tablica [i,j] indeksów graczy; długość MUSI być parzysta.
// Zwraca tablicę [[edgeA, edgeB], ...] albo null gdy się nie da.
// Heurystyka MRV (minimum remaining values) + backtracking + losowa kolejność partnerów.
function matchPairs(edges, rng) {
  const N = edges.length;
  const used = new Array(N).fill(false);
  const result = [];
  let usedCount = 0;

  // Sąsiedztwo: dla każdej krawędzi lista indeksów krawędzi rozłącznych.
  const adj = edges.map((e, i) => {
    const list = [];
    for (let j = 0; j < N; j++) if (j !== i && disjoint(e, edges[j])) list.push(j);
    return list;
  });

  function backtrack() {
    if (usedCount === N) return true;

    // Wybierz niesparowaną krawędź o najmniejszej liczbie dostępnych partnerów.
    let pivot = -1;
    let best = Infinity;
    for (let i = 0; i < N; i++) {
      if (used[i]) continue;
      let cnt = 0;
      for (const j of adj[i]) if (!used[j]) cnt++;
      if (cnt < best) {
        best = cnt;
        pivot = i;
        if (cnt === 0) break;
      }
    }
    if (best === 0) return false; // ślepy zaułek

    const partners = adj[pivot].filter((j) => !used[j]);
    shuffleInPlace(partners, rng);

    used[pivot] = true;
    usedCount++;
    for (const q of partners) {
      if (used[q]) continue;
      used[q] = true;
      usedCount++;
      result.push([edges[pivot], edges[q]]);
      if (backtrack()) return true;
      result.pop();
      used[q] = false;
      usedCount--;
    }
    used[pivot] = false;
    usedCount--;
    return false;
  }

  return backtrack() ? result : null;
}

// Ustaw kolejność meczów tak, by pauzy rozkładały się równo w czasie:
// w każdym kroku wybieramy mecz, którego gracze pauzowali najczęściej do tej pory.
function orderMatches(matches, playerCount, rng) {
  const remaining = matches.slice();
  shuffleInPlace(remaining, rng);
  const ordered = [];
  const byes = new Array(playerCount).fill(0);

  while (remaining.length) {
    let bestIdx = 0;
    let bestScore = -1;
    for (let k = 0; k < remaining.length; k++) {
      const m = remaining[k];
      const playing = [m[0][0], m[0][1], m[1][0], m[1][1]];
      let score = 0;
      for (const p of playing) score += byes[p];
      if (score > bestScore) {
        bestScore = score;
        bestIdx = k;
      }
    }
    const chosen = remaining.splice(bestIdx, 1)[0];
    ordered.push(chosen);
    const playingSet = new Set([chosen[0][0], chosen[0][1], chosen[1][0], chosen[1][1]]);
    for (let p = 0; p < playerCount; p++) if (!playingSet.has(p)) byes[p]++;
  }
  return ordered;
}

/**
 * Wygeneruj harmonogram partner round-robin.
 * @param {Array} playerIds - lista identyfikatorów graczy (dowolne wartości), min. 4.
 * @param {number} seed - ziarno losowości (nowe ziarno = "Przelosuj").
 * @returns {Array<{teamA:[any,any], teamB:[any,any]}>} lista meczów w kolejności rozgrywania.
 */
export function generateSchedule(playerIds, seed = 1) {
  const n = playerIds.length;
  if (n < 4) throw new Error('Wymagane minimum 4 graczy.');

  const rng = makeRng(seed);

  // Wszystkie pary jako indeksy [i,j].
  const pairs = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) pairs.push([i, j]);
  const P = pairs.length;

  let matchedIdx = null;
  if (P % 2 === 0) {
    matchedIdx = matchPairs(pairs, rng);
  } else {
    // Nieparzysta liczba par: dołóż jedną zdublowaną parę, żeby dopełnić do parzystej.
    // Próbujemy różne pary do zdublowania aż skojarzenie się powiedzie.
    const order = shuffleInPlace([...pairs.keys()], rng);
    for (const dup of order) {
      const pool = pairs.concat([pairs[dup].slice()]);
      const res = matchPairs(pool, rng);
      if (res) {
        matchedIdx = res;
        break;
      }
    }
  }
  if (!matchedIdx) throw new Error('Nie udało się wygenerować harmonogramu dla ' + n + ' graczy.');

  // Kolejność meczów pod kątem równych pauz (na indeksach), potem mapowanie na id graczy.
  const orderedIdx = orderMatches(matchedIdx, n, rng);
  return orderedIdx.map((m) => ({
    teamA: [playerIds[m[0][0]], playerIds[m[0][1]]],
    teamB: [playerIds[m[1][0]], playerIds[m[1][1]]],
  }));
}

/**
 * Wygeneruj harmonogram 3v3 dla DOKŁADNIE 6 graczy: każda trójka gra razem (jako drużyna) raz.
 * C(6,3)=20 trójek -> 10 komplementarnych podziałów -> 10 meczów; grają wszyscy (brak pauz).
 * Kanonizacja podziału: drużyna zawierająca gracza o indeksie 0 + jej dopełnienie — to daje
 * dokładnie C(5,2)=10 unikalnych podziałów, a każda z 20 trójek pojawia się dokładnie raz.
 * @param {Array} playerIds - lista identyfikatorów graczy, dokładnie 6.
 * @param {number} seed - ziarno losowości (nowe ziarno = "Przelosuj").
 * @returns {Array<{teamA:[any,any,any], teamB:[any,any,any]}>} lista meczów w kolejności rozgrywania.
 */
export function generateSchedule3v3(playerIds, seed = 1) {
  if (playerIds.length !== 6) throw new Error('Tryb 3v3 wymaga dokładnie 6 graczy.');
  const rng = makeRng(seed);

  // Wszystkie podziały na dwie trójki (na indeksach): [0,i,j] + dopełnienie.
  const splits = [];
  for (let i = 1; i < 6; i++) {
    for (let j = i + 1; j < 6; j++) {
      splits.push([
        [0, i, j],
        [1, 2, 3, 4, 5].filter((k) => k !== i && k !== j),
      ]);
    }
  }

  shuffleInPlace(splits, rng); // kolejność meczów
  return splits.map(([a, b]) => {
    if (rng() < 0.5) [a, b] = [b, a]; // losowa strona — gracz 0 nie zawsze w drużynie A
    shuffleInPlace(a, rng); // kolejność nazwisk w drużynie
    shuffleInPlace(b, rng);
    return { teamA: a.map((k) => playerIds[k]), teamB: b.map((k) => playerIds[k]) };
  });
}

/** Gracze pauzujący w danym meczu = wszyscy uczestnicy minus grający. */
export function sittingOut(match, allPlayerIds) {
  const playing = new Set([...match.teamA, ...match.teamB]);
  return allPlayerIds.filter((id) => !playing.has(id));
}

/** Oczekiwana liczba meczów 2v2 dla n graczy (do walidacji/informacji w UI). */
export function expectedMatchCount(n) {
  const pairs = (n * (n - 1)) / 2;
  return Math.ceil(pairs / 2);
}

/** Oczekiwana liczba meczów 3v3 (zdefiniowane tylko dla 6 graczy): C(6,3)/2 = 10. */
export function expectedMatchCount3v3() {
  return 10;
}
