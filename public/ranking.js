// Ranking indywidualny + walidacja wyników. Czysta logika (import w przeglądarce i w testach).
//
// Reguły domenowe:
//   - wygrana = 3 pkt dla OBU graczy zwycięskiej drużyny, przegrana = 0,
//   - brak remisów (w HaxBall zawsze jest zwycięzca) — walidowane twardo,
//   - bilans gracza = bramki zdobyte przez jego drużyny − bramki stracone,
//   - sortowanie: punkty ↓, bilans ↓, bramki zdobyte ↓ (na końcu alfabetycznie dla determinizmu).

/**
 * Waliduje wynik meczu.
 * @returns {{ok:true, a:number, b:number} | {ok:false, error:string}}
 */
export function validateScore(scoreA, scoreB) {
  const empty = (v) => v === null || v === undefined || v === '';
  if (empty(scoreA) || empty(scoreB)) return { ok: false, error: 'Podaj oba wyniki.' };
  const a = Number(scoreA);
  const b = Number(scoreB);
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
    return { ok: false, error: 'Wynik musi być liczbą całkowitą ≥ 0.' };
  }
  if (a === b) return { ok: false, error: 'Remis niedozwolony — popraw wynik.' };
  return { ok: true, a, b };
}

/**
 * Oblicza tabelę rankingu.
 * @param {Array<{id:any, name:string}>} participants - uczestnicy turnieju.
 * @param {Array<{teamA:any[], teamB:any[], scoreA:?number, scoreB:?number}>} matches
 *        - mecze; wynik null/undefined = jeszcze nierozegrany (pomijany).
 * @returns {Array<object>} wiersze tabeli z polem `place` (1-indexed).
 */
export function computeRanking(participants, matches) {
  const stats = new Map();
  for (const p of participants) {
    stats.set(p.id, {
      id: p.id,
      name: p.name,
      played: 0,
      wins: 0,
      losses: 0,
      points: 0,
      gf: 0, // bramki zdobyte (goals for)
      ga: 0, // bramki stracone (goals against)
      diff: 0,
    });
  }

  for (const m of matches) {
    if (m.scoreA === null || m.scoreA === undefined || m.scoreB === null || m.scoreB === undefined) continue;
    const a = Number(m.scoreA);
    const b = Number(m.scoreB);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a === b) continue; // ochrona przed błędnymi/remisowymi

    const aWon = a > b;
    for (const id of m.teamA) {
      const s = stats.get(id);
      if (!s) continue;
      s.played++;
      s.gf += a;
      s.ga += b;
      if (aWon) {
        s.wins++;
        s.points += 3;
      } else {
        s.losses++;
      }
    }
    for (const id of m.teamB) {
      const s = stats.get(id);
      if (!s) continue;
      s.played++;
      s.gf += b;
      s.ga += a;
      if (!aWon) {
        s.wins++;
        s.points += 3;
      } else {
        s.losses++;
      }
    }
  }

  const rows = [...stats.values()];
  for (const s of rows) s.diff = s.gf - s.ga;

  rows.sort(
    (x, y) =>
      y.points - x.points ||
      y.diff - x.diff ||
      y.gf - x.gf ||
      String(x.name).localeCompare(String(y.name), 'pl'),
  );
  rows.forEach((r, i) => (r.place = i + 1));
  return rows;
}
