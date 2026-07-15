import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeRanking, validateScore } from '../public/ranking.js';

test('validateScore: odrzuca remis', () => {
  const r = validateScore(5, 5);
  assert.equal(r.ok, false);
  assert.match(r.error, /remis/i);
});

test('validateScore: odrzuca puste / ujemne / nie-całkowite', () => {
  assert.equal(validateScore('', 3).ok, false);
  assert.equal(validateScore(3, null).ok, false);
  assert.equal(validateScore(-1, 2).ok, false);
  assert.equal(validateScore(1.5, 2).ok, false);
});

test('validateScore: akceptuje poprawny wynik i parsuje liczby', () => {
  const r = validateScore('6', '10');
  assert.deepEqual(r, { ok: true, a: 6, b: 10 });
});

test('computeRanking: punktacja 3/0, bilans, rozegrane', () => {
  const participants = [
    { id: 1, name: 'Ala' },
    { id: 2, name: 'Bea' },
    { id: 3, name: 'Cezary' },
    { id: 4, name: 'Dawid' },
  ];
  // Mecz: (Ala,Bea) 10 : 6 (Cezary,Dawid) → Ala i Bea wygrywają.
  const matches = [{ teamA: [1, 2], teamB: [3, 4], scoreA: 10, scoreB: 6 }];
  const r = computeRanking(participants, matches);

  const byId = Object.fromEntries(r.map((x) => [x.id, x]));
  assert.equal(byId[1].points, 3);
  assert.equal(byId[1].wins, 1);
  assert.equal(byId[1].gf, 10);
  assert.equal(byId[1].ga, 6);
  assert.equal(byId[1].diff, 4);
  assert.equal(byId[3].points, 0);
  assert.equal(byId[3].losses, 1);
  assert.equal(byId[3].diff, -4);
  assert.equal(byId[1].played, 1);
});

test('computeRanking: sortowanie punkty → bilans → bramki zdobyte', () => {
  const participants = [
    { id: 1, name: 'A' },
    { id: 2, name: 'B' },
    { id: 3, name: 'C' },
    { id: 4, name: 'D' },
  ];
  // Konstruujemy tak, by rozdzielić kryteria sortowania.
  const matches = [
    { teamA: [1, 2], teamB: [3, 4], scoreA: 10, scoreB: 0 }, // 1,2 +3 (bilans +10)
    { teamA: [1, 3], teamB: [2, 4], scoreA: 10, scoreB: 9 }, // 1,3 +3
    { teamA: [1, 4], teamB: [2, 3], scoreA: 10, scoreB: 8 }, // 1,4 +3
  ];
  const r = computeRanking(participants, matches);
  // Gracz 1 wygrał wszystko → 9 pkt, miejsce 1.
  assert.equal(r[0].id, 1);
  assert.equal(r[0].points, 9);
  assert.equal(r[0].place, 1);
  // Miejsca są kolejne 1..4
  assert.deepEqual(r.map((x) => x.place), [1, 2, 3, 4]);
});

test('computeRanking: drużyny 3-osobowe (tryb 3v3) liczone tak samo', () => {
  const participants = [1, 2, 3, 4, 5, 6].map((id) => ({ id, name: `G${id}` }));
  const matches = [{ teamA: [1, 2, 3], teamB: [4, 5, 6], scoreA: 5, scoreB: 3 }];
  const r = computeRanking(participants, matches);
  const byId = new Map(r.map((x) => [x.id, x]));
  for (const id of [1, 2, 3]) {
    const s = byId.get(id);
    assert.equal(s.points, 3, `gracz ${id}: 3 pkt za wygraną`);
    assert.equal(s.played, 1);
    assert.equal(s.gf, 5);
    assert.equal(s.ga, 3);
    assert.equal(s.diff, 2);
  }
  for (const id of [4, 5, 6]) {
    const s = byId.get(id);
    assert.equal(s.points, 0, `gracz ${id}: 0 pkt za przegraną`);
    assert.equal(s.played, 1);
    assert.equal(s.diff, -2);
  }
});

test('computeRanking: pomija mecze bez wyniku i ewentualne remisy', () => {
  const participants = [
    { id: 1, name: 'A' },
    { id: 2, name: 'B' },
    { id: 3, name: 'C' },
    { id: 4, name: 'D' },
  ];
  const matches = [
    { teamA: [1, 2], teamB: [3, 4], scoreA: null, scoreB: null }, // nierozegrany
    { teamA: [1, 3], teamB: [2, 4], scoreA: 5, scoreB: 5 }, // remis (defensywnie pomijany)
  ];
  const r = computeRanking(participants, matches);
  for (const row of r) {
    assert.equal(row.played, 0);
    assert.equal(row.points, 0);
  }
});
