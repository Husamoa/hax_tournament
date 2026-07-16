// Klient JSON API. Wszystkie wywołania idą przez api/index.php (routing query-string).
// Ścieżka względna działa zarówno lokalnie (dev-server.php) jak i na OVH (public/ + api/).

const BASE = 'api/index.php';

async function req(method, r, params = {}, body = null) {
  const qs = new URLSearchParams({ r, ...params }).toString();
  const opts = { method, headers: {}, credentials: 'same-origin' };
  if (body !== null) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}?${qs}`, opts);
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('Niepoprawna odpowiedź serwera: ' + text.slice(0, 200));
    }
  }
  if (!res.ok) {
    const msg = (data && data.error) || `Błąd HTTP ${res.status}`;
    const e = new Error(msg);
    e.status = res.status;
    throw e;
  }
  return data;
}

export const api = {
  // sesja / logowanie
  session: () => req('GET', 'session'),
  login: (password) => req('POST', 'login', {}, { password }),
  logout: () => req('POST', 'logout'),

  // roster
  players: () => req('GET', 'players'),
  addPlayer: (name, isGuest = false) => req('POST', 'players', {}, { name, is_guest: isGuest ? 1 : 0 }),
  archivePlayer: (id) => req('PATCH', 'players', { id }),

  // turnieje
  tournaments: () => req('GET', 'tournaments'),
  tournament: (id) => req('GET', 'tournaments', { id }),
  createTournament: (payload) => req('POST', 'tournaments', {}, payload),
  setAutoFill: (id, on) => req('PATCH', 'tournaments', { id }, { auto_fill: on ? 1 : 0 }),
  deleteTournament: (id) => req('DELETE', 'tournaments', { id }),
  finishTournament: (id, winnerId) => req('POST', 'finish', { id }, { winner_player_id: winnerId }),
  reopenTournament: (id) => req('POST', 'reopen', { id }),

  // wyniki
  setScore: (matchId, scoreA, scoreB) =>
    req('PATCH', 'matches', { id: matchId }, { score_a: scoreA, score_b: scoreB }),

  // statystyki (surowe mecze + aliasy — liczone po stronie klienta w stats.js)
  stats: () => req('GET', 'stats'),
  setStatMatchTraining: (id, training) => req('PATCH', 'stat_matches', { id }, { is_training: training ? 1 : 0 }),

  // aliasy (scalanie nicków)
  aliases: () => req('GET', 'aliases'),
  addAlias: (alias, canonical) => req('POST', 'aliases', {}, { alias, canonical }),
  deleteAlias: (alias) => req('DELETE', 'aliases', { alias }),
};
