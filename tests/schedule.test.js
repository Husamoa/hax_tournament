import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateSchedule,
  generateSchedule3v3,
  sittingOut,
  expectedMatchCount,
  expectedMatchCount3v3,
} from '../public/schedule.js';

const pairKey = (x, y) => (x < y ? `${x}|${y}` : `${y}|${x}`);
const C = (n) => (n * (n - 1)) / 2;

// Sprawdza wszystkie niezmienniki harmonogramu dla listy graczy [0..n-1].
function checkInvariants(n, seed) {
  const players = Array.from({ length: n }, (_, i) => i);
  const schedule = generateSchedule(players, seed);

  const pairsEven = C(n) % 2 === 0;
  const expectedMatches = expectedMatchCount(n);

  // 1) liczba meczów
  assert.equal(schedule.length, expectedMatches, `n=${n} seed=${seed}: liczba meczów`);

  const pairCount = new Map();
  const games = new Array(n).fill(0);

  for (const m of schedule) {
    const four = [...m.teamA, ...m.teamB];
    // 2) w meczu 4 różnych graczy (drużyny nie mają wspólnego gracza)
    assert.equal(new Set(four).size, 4, `n=${n} seed=${seed}: 4 różnych graczy w meczu`);

    // 3) pauzujący = uczestnicy minus 4 grających
    const bye = sittingOut(m, players);
    assert.equal(bye.length, n - 4, `n=${n} seed=${seed}: liczba pauzujących`);

    for (const p of four) games[p]++;
    for (const key of [pairKey(m.teamA[0], m.teamA[1]), pairKey(m.teamB[0], m.teamB[1])]) {
      pairCount.set(key, (pairCount.get(key) || 0) + 1);
    }
  }

  // 4) każda para pokryta co najmniej raz
  assert.equal(pairCount.size, C(n), `n=${n} seed=${seed}: wszystkie pary pokryte`);
  for (const [key, cnt] of pairCount) {
    assert.ok(cnt >= 1 && cnt <= 2, `n=${n} seed=${seed}: para ${key} pokryta ${cnt}x`);
  }

  // 5) liczba par pokrytych 2x: 0 gdy C(n,2) parzyste, dokładnie 1 gdy nieparzyste
  const doubled = [...pairCount.values()].filter((c) => c === 2).length;
  assert.equal(doubled, pairsEven ? 0 : 1, `n=${n} seed=${seed}: liczba zdublowanych par`);

  // 6) balans gier/pauz: max−min ≤ 1
  const maxG = Math.max(...games);
  const minG = Math.min(...games);
  assert.ok(maxG - minG <= 1, `n=${n} seed=${seed}: balans gier (${minG}..${maxG})`);

  return { matches: schedule.length, minGames: minG, maxGames: maxG };
}

test('generator: niezmienniki dla n=4..8 przez wiele seedów', () => {
  for (let n = 4; n <= 8; n++) {
    for (let seed = 1; seed <= 200; seed++) {
      checkInvariants(n, seed);
    }
  }
});

test('generator: liczba meczów zgodna z tabelą planu (3/5/8/11/14)', () => {
  const expected = { 4: 3, 5: 5, 6: 8, 7: 11, 8: 14 };
  const summary = {};
  for (let n = 4; n <= 8; n++) {
    const r = checkInvariants(n, 12345);
    summary[n] = r.matches;
    assert.equal(r.matches, expected[n], `n=${n}: oczekiwano ${expected[n]} meczów`);
  }
  // wypis informacyjny (widoczny przy `node --test`)
  console.log('Liczba meczów wg n:', JSON.stringify(summary));
});

test('generator: działa też dla większych n (9..12)', () => {
  for (let n = 9; n <= 12; n++) {
    for (let seed = 1; seed <= 30; seed++) checkInvariants(n, seed);
  }
});

test('generator: mniej niż 4 graczy = błąd', () => {
  assert.throws(() => generateSchedule([1, 2, 3], 1), /minimum 4/i);
});

test('generator: ten sam seed daje identyczny harmonogram', () => {
  const a = generateSchedule([10, 20, 30, 40, 50, 60], 777);
  const b = generateSchedule([10, 20, 30, 40, 50, 60], 777);
  assert.deepEqual(a, b);
});

// ------------------------------------------------------------------ tryb 3v3

const trioKey = (t) => [...t].sort((x, y) => x - y).join('|');

test('3v3: 10 meczów, komplet 6 graczy w każdym, każda trójka dokładnie raz', () => {
  const players = [10, 20, 30, 40, 50, 60];
  for (let seed = 1; seed <= 200; seed++) {
    const schedule = generateSchedule3v3(players, seed);

    // 1) liczba meczów
    assert.equal(schedule.length, expectedMatchCount3v3(), `seed=${seed}: liczba meczów`);

    const trios = new Set();
    for (const m of schedule) {
      // 2) drużyny po 3, mecz = 6 różnych graczy (grają wszyscy)
      assert.equal(m.teamA.length, 3, `seed=${seed}: teamA po 3`);
      assert.equal(m.teamB.length, 3, `seed=${seed}: teamB po 3`);
      assert.equal(new Set([...m.teamA, ...m.teamB]).size, 6, `seed=${seed}: 6 różnych graczy`);

      // 3) brak pauzujących
      assert.deepEqual(sittingOut(m, players), [], `seed=${seed}: brak pauz`);

      trios.add(trioKey(m.teamA));
      trios.add(trioKey(m.teamB));
    }

    // 4) 20 wpisów trójek, 20 różnych => każda z C(6,3) trójek dokładnie raz
    assert.equal(trios.size, 20, `seed=${seed}: każda trójka gra razem dokładnie raz`);
  }
});

test('3v3: ten sam seed daje identyczny harmonogram', () => {
  const a = generateSchedule3v3([1, 2, 3, 4, 5, 6], 777);
  const b = generateSchedule3v3([1, 2, 3, 4, 5, 6], 777);
  assert.deepEqual(a, b);
});

test('3v3: inna liczba graczy niż 6 = błąd', () => {
  assert.throws(() => generateSchedule3v3([1, 2, 3, 4, 5], 1), /dokładnie 6/i);
  assert.throws(() => generateSchedule3v3([1, 2, 3, 4, 5, 6, 7], 1), /dokładnie 6/i);
});
