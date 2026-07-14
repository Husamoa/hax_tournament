import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSchedule, sittingOut, expectedMatchCount } from '../public/schedule.js';

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
