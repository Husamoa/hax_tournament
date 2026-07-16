import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as stats from '../public/stats.js';

// Pomocnik: mecz w kształcie z API (?r=stats).
function m(id, red, blue, rs, bs, startedAt = 1000, goals = []) {
  return {
    id,
    source: 'live',
    started_at: startedAt,
    red_score: rs,
    blue_score: bs,
    winner: rs > bs ? 'red' : 'blue',
    red,
    blue,
    goals,
  };
}

test('leaderboard: mecze/wygrane, bilans i BZ/BS, ranking po ELO', () => {
  const ms = [m('L1', ['Ala', 'Bea'], ['Cezary', 'Dawid'], 5, 2)];
  const rows = stats.leaderboard(ms);
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(by.Ala.wins, 1);
  assert.equal(by.Ala.gf, 5);
  assert.equal(by.Ala.ga, 2);
  assert.equal(by.Ala.goal_diff, 3);
  assert.equal(by.Cezary.losses, 1);
  assert.equal(rows[0].place, 1);
  assert.ok(rows[0].elo >= rows[1].elo); // sort po ELO
  assert.equal(by.Ala.points, undefined); // punkty tylko w turniejach
});

test('leaderboard: gole/asysty przeniesione do profilu gracza (nie w globalnej tabeli)', () => {
  const goals = [
    { time: 10, team: 'red', scorer: 'Ala', assist: 'Bea', own_goal: false },
    { time: 20, team: 'red', scorer: 'Cezary', assist: null, own_goal: true },
  ];
  const ms = [m('L1', ['Ala', 'Bea'], ['Cezary', 'Dawid'], 2, 0, 1000, goals)];
  assert.equal(stats.playerDetail(ms, 'Ala').stats.goals, 1);
  assert.equal(stats.playerDetail(ms, 'Bea').stats.assists, 1);
  assert.equal(stats.playerDetail(ms, 'Cezary').stats.own_goals, 1);
  assert.equal(stats.playerDetail(ms, 'Cezary').stats.goals, 0);
});

test('counted: wyklucza 1v1 i 2v1, zostawia 2v2 i 3v2', () => {
  const ms = [
    m('L1', ['A', 'B'], ['C', 'D'], 3, 1),            // 2v2 — zostaje
    m('L2', ['A', 'B', 'C'], ['D', 'E'], 4, 2),       // 3v2 — zostaje
    m('L3', ['A'], ['B'], 2, 0),                       // 1v1 — out
    m('L4', ['A', 'B'], ['C'], 3, 0),                  // 2v1 — out
  ];
  assert.deepEqual(stats.counted(ms).map((x) => x.id), ['L1', 'L2']);
});

test('elo: przewaga liczebna — wygrana słabszej liczebnie waży więcej niż silniejszej', () => {
  // 3v2, równe oceny startowe. Underdog (dwójka) wygrywa vs faworyt (trójka) wygrywa.
  const under = stats.eloRatings([m('L1', ['A', 'B', 'C'], ['D', 'E'], 0, 1)]); // dwójka (blue) wygrywa
  const fav = stats.eloRatings([m('L1', ['A', 'B', 'C'], ['D', 'E'], 1, 0)]);   // trójka (red) wygrywa
  const underGain = under.get('D') - 1000; // gracz zwycięskiej dwójki
  const favGain = fav.get('A') - 1000;     // gracz zwycięskiej trójki
  assert.ok(underGain > favGain, `underdog ${underGain} powinno być > faworyt ${favGain}`);
  assert.ok(favGain > 0 && favGain < underGain);
});

test('aliasy: scalają statystyki pod aktualnym nickiem', () => {
  const amap = stats.aliasMap([{ alias: 'Ala_old', canonical: 'Ala' }]);
  const raw = [
    m('L1', ['Ala', 'Bea'], ['Cezary', 'Dawid'], 3, 1),
    m('L2', ['Ala_old', 'Bea'], ['Cezary', 'Dawid'], 4, 0, 2000),
  ];
  const resolved = stats.resolveMatches(raw, amap);
  const rows = stats.leaderboard(resolved);
  const by = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(by.Ala.matches, 2);
  assert.equal(by.Ala.wins, 2);
  assert.equal(by.Ala_old, undefined);
});

test('head-to-head: liczy tylko mecze po przeciwnych stronach', () => {
  const ms = [
    m('L1', ['Ala', 'X'], ['Bea', 'Y'], 3, 1), // Ala vs Bea
    m('L2', ['Ala', 'Bea'], ['C', 'D'], 2, 5), // razem — nie liczy się
    m('L3', ['Bea', 'X'], ['Ala', 'Y'], 4, 2), // Bea vs Ala, Bea wygrywa
  ];
  const r = stats.headToHead(ms, 'Ala', 'Bea');
  assert.equal(r.games, 2);
  assert.equal(r.a_wins, 1);
  assert.equal(r.b_wins, 1);
});

test('teammates: gry i wygrane wspólne', () => {
  const ms = [
    m('L1', ['Ala', 'Bea'], ['C', 'D'], 3, 1),
    m('L2', ['Ala', 'Bea'], ['C', 'D'], 0, 2),
    m('L3', ['Ala', 'C'], ['Bea', 'D'], 5, 1),
  ];
  const mates = stats.teammates(ms, 'Ala');
  const bea = mates.find((x) => x.partner === 'Bea');
  assert.equal(bea.games, 2);
  assert.equal(bea.wins, 1);
});

test('elo: zwycięzca rośnie ponad bazę, przegrany spada', () => {
  const elo = stats.eloRatings([m('L1', ['Ala', 'Bea'], ['C', 'D'], 3, 0)]);
  assert.ok(elo.get('Ala') > 1000);
  assert.ok(elo.get('C') < 1000);
});

test('kategorie i summary', () => {
  const ms = [
    m('L1', ['Ala', 'Bea'], ['C', 'D'], 3, 0, 1000, [{ time: 1, team: 'red', scorer: null, assist: null, own_goal: false }]),
    m('L2', ['Ala'], ['C'], 1, 0, 2000),
  ];
  const cats = stats.categories(ms);
  assert.deepEqual(cats.map((c) => c.category).sort(), ['1v1', '2v2']);
  const s = stats.summary(ms);
  assert.equal(s.total_matches, 2);
  assert.equal(s.total_goals, 1);
  assert.equal(s.total_players, 4); // Ala,Bea,C,D
});

test('playerDetail: null gdy gracz nie grał', () => {
  assert.equal(stats.playerDetail([m('L1', ['Ala'], ['C'], 1, 0)], 'Ktoś'), null);
});
