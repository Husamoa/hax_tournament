// Statystyki globalne — czysta logika liczona po stronie klienta (jak schedule.js / ranking.js).
// Wejście: płaska lista meczów name-based z API (`?r=stats`) + lista aliasów.
//
// Kształt meczu:
//   { id, source:'live'|'tournament', started_at:<unix s>, red_score, blue_score,
//     winner:'red'|'blue', red:[nick...], blue:[nick...],
//     goals:[{time, team, scorer|null, assist|null, own_goal:bool}] }
//
// Reguły domenowe Pitole: wygrana = 3 pkt, brak remisów, bilans = bramki drużyn − stracone.
// Statystyki indywidualne (gole/asysty) bywają zerowe — kolektor z DOM przeglądarki nie
// zna strzelca/asysty (wysyła null). To świadome ograniczenie źródła.

const ELO_BASE = 1000;
const ELO_K = 32;

// ------------------------------------------------------------------ aliasy
export function aliasMap(aliases) {
  const m = new Map();
  for (const a of aliases || []) m.set(a.alias, a.canonical);
  return m;
}

export function resolve(name, amap) {
  const seen = new Set();
  while (amap.has(name) && !seen.has(name)) {
    seen.add(name);
    name = amap.get(name);
  }
  return name;
}

function uniq(list) {
  return [...new Set(list)];
}

/** Zwraca kopię meczów z nickami zresolvowanymi przez aliasy (składy odduplikowane). */
export function resolveMatches(matches, amap) {
  return (matches || []).map((m) => ({
    ...m,
    red: uniq(m.red.map((n) => resolve(n, amap))),
    blue: uniq(m.blue.map((n) => resolve(n, amap))),
    goals: (m.goals || []).map((g) => ({
      ...g,
      scorer: g.scorer ? resolve(g.scorer, amap) : null,
      assist: g.assist ? resolve(g.assist, amap) : null,
    })),
  }));
}

// ------------------------------------------------------------------ pomocnicze
/** Kategoria z rozmiarów drużyn: większa strona pierwsza (2v3 == 3v2). */
export function category(m) {
  const hi = Math.max(m.red.length, m.blue.length);
  const lo = Math.min(m.red.length, m.blue.length);
  return `${hi}v${lo}`;
}

/** Lokalna data kalendarzowa (YYYY-MM-DD) meczu. */
export function matchDay(startedAt) {
  const d = new Date(startedAt * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function winRate(wins, matches) {
  return matches ? wins / matches : 0;
}

// ------------------------------------------------------------------ Elo
/** Globalny Elo per gracz, odtworzony chronologicznie. Oczekiwany wynik ze średniej
 *  oceny drużyny — radzi sobie z różnymi rozmiarami drużyn. */
export function eloRatings(matches) {
  const ratings = new Map();
  const get = (p) => (ratings.has(p) ? ratings.get(p) : ELO_BASE);
  const sorted = [...matches].sort((a, b) => a.started_at - b.started_at);
  for (const m of sorted) {
    if (!m.red.length || !m.blue.length) continue;
    const ra = m.red.reduce((s, p) => s + get(p), 0) / m.red.length;
    const rb = m.blue.reduce((s, p) => s + get(p), 0) / m.blue.length;
    const ea = 1 / (1 + 10 ** ((rb - ra) / 400));
    const sa = m.winner === 'red' ? 1 : 0;
    for (const p of m.red) ratings.set(p, get(p) + ELO_K * (sa - ea));
    for (const p of m.blue) ratings.set(p, get(p) + ELO_K * (1 - sa - (1 - ea)));
  }
  return ratings;
}

// ------------------------------------------------------------------ leaderboard
/**
 * Tabela globalna. `matches` już zresolvowane aliasami (patrz resolveMatches).
 * Filtry opcjonalne: {day, category}.
 */
export function leaderboard(matches, { day = null, category: cat = null } = {}) {
  let ms = matches;
  if (day !== null) ms = ms.filter((m) => matchDay(m.started_at) === day);
  if (cat !== null) ms = ms.filter((m) => category(m) === cat);

  const t = new Map();
  const tally = (name) => {
    if (!t.has(name)) {
      t.set(name, {
        name, matches: 0, wins: 0, losses: 0, points: 0,
        gf: 0, ga: 0, goals: 0, assists: 0, own_goals: 0,
      });
    }
    return t.get(name);
  };

  for (const m of ms) {
    for (const team of ['red', 'blue']) {
      const gf = team === 'red' ? m.red_score : m.blue_score;
      const ga = team === 'red' ? m.blue_score : m.red_score;
      for (const name of m[team]) {
        const e = tally(name);
        e.matches++;
        e.gf += gf;
        e.ga += ga;
        if (team === m.winner) { e.wins++; e.points += 3; }
        else e.losses++;
      }
    }
    for (const g of m.goals) {
      if (g.own_goal) { if (g.scorer) tally(g.scorer).own_goals++; }
      else {
        if (g.scorer) tally(g.scorer).goals++;
        if (g.assist) tally(g.assist).assists++;
      }
    }
  }

  const elo = eloRatings(matches); // Elo zawsze globalne, niezależne od filtra
  const rows = [...t.values()].map((e) => ({
    ...e,
    goal_diff: e.gf - e.ga,
    win_rate: winRate(e.wins, e.matches),
    elo: Math.round(elo.has(e.name) ? elo.get(e.name) : ELO_BASE),
  }));
  rows.sort(
    (x, y) =>
      y.points - x.points ||
      y.goal_diff - x.goal_diff ||
      y.gf - x.gf ||
      String(x.name).localeCompare(String(y.name), 'pl'),
  );
  rows.forEach((r, i) => (r.place = i + 1));
  return rows;
}

// ------------------------------------------------------------------ profil gracza
export function playerDetail(matches, name) {
  const played = [];
  for (const m of matches) {
    if (m.red.includes(name)) played.push([m, 'red']);
    else if (m.blue.includes(name)) played.push([m, 'blue']);
  }
  if (!played.length) return null;

  let wins = 0, gf = 0, ga = 0, goals = 0, assists = 0, ownGoals = 0;
  for (const [m, team] of played) {
    if (team === m.winner) wins++;
    gf += team === 'red' ? m.red_score : m.blue_score;
    ga += team === 'red' ? m.blue_score : m.red_score;
    for (const g of m.goals) {
      if (g.own_goal) { if (g.scorer === name) ownGoals++; }
      else {
        if (g.scorer === name) goals++;
        if (g.assist === name) assists++;
      }
    }
  }

  const recent = [...played]
    .sort((a, b) => b[0].started_at - a[0].started_at)
    .map(([m, team]) => ({
      id: m.id,
      started_at: m.started_at,
      red_score: m.red_score,
      blue_score: m.blue_score,
      winner: m.winner,
      team,
      won: team === m.winner,
      red: m.red,
      blue: m.blue,
    }));

  const elo = eloRatings(matches);
  return {
    name,
    stats: {
      matches: played.length,
      wins,
      losses: played.length - wins,
      win_rate: winRate(wins, played.length),
      gf, ga, goal_diff: gf - ga,
      goals, assists, own_goals: ownGoals,
      elo: Math.round(elo.has(name) ? elo.get(name) : ELO_BASE),
    },
    recent_matches: recent,
  };
}

// ------------------------------------------------------------------ head-to-head
export function headToHead(matches, a, b) {
  let games = 0, aWins = 0, bWins = 0;
  for (const m of matches) {
    let aTeam, bTeam;
    if (m.red.includes(a) && m.blue.includes(b)) { aTeam = 'red'; bTeam = 'blue'; }
    else if (m.blue.includes(a) && m.red.includes(b)) { aTeam = 'blue'; bTeam = 'red'; }
    else continue;
    games++;
    if (m.winner === aTeam) aWins++;
    else if (m.winner === bTeam) bWins++;
  }
  return { a, b, games, a_wins: aWins, b_wins: bWins };
}

// ------------------------------------------------------------------ partnerzy
export function teammates(matches, name) {
  const t = new Map();
  for (const m of matches) {
    for (const team of ['red', 'blue']) {
      if (!m[team].includes(name)) continue;
      for (const partner of m[team]) {
        if (partner === name) continue;
        if (!t.has(partner)) t.set(partner, { partner, games: 0, wins: 0 });
        const e = t.get(partner);
        e.games++;
        if (team === m.winner) e.wins++;
      }
    }
  }
  const rows = [...t.values()].map((e) => ({ ...e, win_rate: winRate(e.wins, e.games) }));
  rows.sort((x, y) => y.games - x.games);
  return rows;
}

// ------------------------------------------------------------------ dni / kategorie / podsumowanie
export function days(matches, cat = null) {
  const ms = cat !== null ? matches.filter((m) => category(m) === cat) : matches;
  const counts = new Map();
  for (const m of ms) {
    const d = matchDay(m.started_at);
    counts.set(d, (counts.get(d) || 0) + 1);
  }
  return [...counts.keys()]
    .sort((x, y) => (x < y ? 1 : -1))
    .map((d) => {
      const lb = leaderboard(ms, { day: d, category: cat });
      return { date: d, matches: counts.get(d), champion: lb.length ? lb[0].name : null };
    });
}

export function categories(matches) {
  const counts = new Map();
  for (const m of matches) {
    const c = category(m);
    counts.set(c, (counts.get(c) || 0) + 1);
  }
  const rows = [...counts.entries()].map(([c, n]) => ({ category: c, matches: n }));
  rows.sort((x, y) => y.matches - x.matches || x.category.localeCompare(y.category));
  return rows;
}

export function summary(matches) {
  const players = new Set();
  let totalGoals = 0;
  for (const m of matches) {
    for (const n of m.red) players.add(n);
    for (const n of m.blue) players.add(n);
    totalGoals += m.goals.length;
  }
  return { total_matches: matches.length, total_goals: totalGoals, total_players: players.size };
}
