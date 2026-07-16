import { api } from './api.js';
import { generateSchedule, generateSchedule3v3, sittingOut, expectedMatchCount, expectedMatchCount3v3 } from './schedule.js';
import { computeRanking, validateScore } from './ranking.js';
import * as stats from './stats.js';
import { APP_VERSION } from './version.js';

// ------------------------------------------------------------------ stan
const state = {
  authed: false,
  tab: 'turniej',
  players: [], // roster [{id,name,is_guest,archived}]
  tournaments: [], // podsumowania
  active: null, // pełny aktywny turniej albo null
  draft: null, // {name, seed, playerIds:[], matches:[]}
  setup: null, // {name, selected:Set} — ekran wyboru graczy
  subtab: 'mecze', // 'mecze' | 'tabela'
  editing: false, // edycja składów w drafcie
  historyDetail: null, // pełny turniej z historii
  // --- statystyki ---
  statsRaw: null, // {matches, aliases} z API (surowe, przed resolvem aliasów)
  statsMatches: [], // mecze po zastosowaniu aliasów
  statsSub: 'ranking', // ranking | mecze | gracz | h2h | dni | kategorie | aliasy
  statsCat: null, // filtr kategorii (np. '2v2') w rankingu
  statsDay: null, // filtr dnia (YYYY-MM-DD) w rankingu
  statsPlayer: null, // wybrany gracz (profil)
  statsExpanded: new Set(), // rozwinięte mecze (id) w historii statystyk
  statsSort: { col: 'elo', dir: 'desc' }, // sortowanie tabeli rankingu (klik nagłówka)
  h2hA: null,
  h2hB: null,
};

// ------------------------------------------------------------------ pomocnicze
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const view = $('#view');

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let toastTimer = null;
function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}

function nameMap(participants) {
  const m = new Map();
  for (const p of participants) m.set(p.id, p.name);
  return m;
}

function fmtDate(s) {
  if (!s) return '';
  return String(s).slice(0, 16).replace('T', ' ');
}

function randSeed() {
  return Math.floor(Math.random() * 2 ** 31);
}

// ------------------------------------------------------------------ dane
async function refreshData() {
  state.players = await api.players();
  state.tournaments = await api.tournaments();
  const act = state.tournaments.find((t) => t.status === 'active');
  state.active = act ? await api.tournament(act.id) : null;
}

// ------------------------------------------------------------------ init / auth
async function init() {
  // wersja aplikacji (jedno źródło: version.js) — ekran logowania + nagłówek
  $$('.js-version').forEach((el) => (el.textContent = 'v' + APP_VERSION));
  // nawigacja (raz)
  $$('.tab').forEach((b) =>
    b.addEventListener('click', () => {
      stopLivePoll();
      state.tab = b.dataset.tab;
      state.historyDetail = null;
      render();
    }),
  );
  $('#logout-btn').addEventListener('click', async () => {
    stopLivePoll();
    await api.logout();
    state.authed = false;
    showLogin();
  });
  $('#login-form').addEventListener('submit', onLogin);

  try {
    const s = await api.session();
    if (s.authed) return enterApp();
  } catch (e) {
    /* pokaż logowanie */
  }
  showLogin();
}

function showLogin() {
  $('#app').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#login-pass').value = '';
  $('#login-pass').focus();
}

async function onLogin(e) {
  e.preventDefault();
  $('#login-error').textContent = '';
  try {
    await api.login($('#login-pass').value);
    await enterApp();
  } catch (err) {
    $('#login-error').textContent = err.message || 'Błąd logowania';
  }
}

async function enterApp() {
  state.authed = true;
  $('#login').classList.add('hidden');
  $('#app').classList.remove('hidden');
  try {
    await refreshData();
  } catch (e) {
    toast('Nie udało się pobrać danych: ' + e.message, true);
  }
  state.tab = 'turniej';
  render();
}

// ------------------------------------------------------------------ render router
function render() {
  $$('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
  if (state.tab === 'turniej') return renderTurniej();
  if (state.tab === 'statystyki') return renderStatystyki();
  if (state.tab === 'historia') return renderHistoria();
  if (state.tab === 'gracze') return renderGracze();
}

// ------------------------------------------------------------------ TURNIEJ
function renderTurniej() {
  if (state.active) return renderActive();
  if (state.draft) return renderDraft();
  return renderSetup();
}

// --- ekran wyboru graczy (nowy turniej) ---
function renderSetup() {
  if (!state.setup) state.setup = { name: '', selected: new Set(), mode: '2v2' };
  if (!state.setup.mode) state.setup.mode = '2v2';
  const roster = state.players;
  const sel = state.setup.selected;
  const n = sel.size;

  view.innerHTML = `
    <h2>Nowy turniej</h2>
    ${
      roster.length === 0
        ? `<div class="empty">Brak graczy. Dodaj ich w zakładce <b>Gracze</b>.</div>`
        : `
    <div class="card">
      <label class="muted">Nazwa (opcjonalnie)</label>
      <input id="t-name" type="text" placeholder="Turniej ${fmtDate(new Date().toISOString())}" value="${esc(state.setup.name)}" style="width:100%;margin-top:6px" />
    </div>
    <div class="card">
      <h3>Format</h3>
      <div class="chips" id="mode-chips">
        <button type="button" class="chip ${state.setup.mode === '2v2' ? 'selected' : ''}" data-mode="2v2">2v2</button>
        <button type="button" class="chip ${state.setup.mode === '3v3' ? 'selected' : ''}" data-mode="3v3">3v3 <span class="badge">6 graczy</span></button>
      </div>
    </div>
    <div class="card">
      <h3>Kto gra?</h3>
      <div class="chips" id="chips">
        ${roster
          .map(
            (p) =>
              `<button type="button" class="chip ${sel.has(p.id) ? 'selected' : ''}" data-id="${p.id}">${esc(p.name)}${p.is_guest ? ' <span class="badge">gość</span>' : ''}</button>`,
          )
          .join('')}
      </div>
      <div class="count-hint" id="hint"></div>
      <div class="row" style="margin-top:8px">
        <input id="guest-name" type="text" placeholder="Dodaj gościa" style="flex:1" />
        <button class="btn btn-ghost" id="add-guest">Dodaj</button>
      </div>
    </div>
    <button class="btn btn-primary btn-block" id="gen" ${(state.setup.mode === '3v3' ? n !== 6 : n < 4) ? 'disabled' : ''}>Generuj harmonogram</button>
    `
    }
  `;

  if (roster.length === 0) return;

  const updateHint = () => {
    const k = state.setup.selected.size;
    const hint = $('#hint');
    if (state.setup.mode === '3v3') {
      if (k !== 6) hint.textContent = `Tryb 3v3 wymaga dokładnie 6 graczy (wybrano ${k}).`;
      else hint.textContent = `Wybrano 6 graczy • ${expectedMatchCount3v3()} meczów`;
      $('#gen').disabled = k !== 6;
    } else {
      if (k < 4) hint.textContent = `Wybrano ${k} — potrzeba minimum 4.`;
      else hint.textContent = `Wybrano ${k} graczy • ${expectedMatchCount(k)} meczów`;
      $('#gen').disabled = k < 4;
    }
  };
  updateHint();

  $('#mode-chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    state.setup.mode = b.dataset.mode;
    $$('.chip', $('#mode-chips')).forEach((c) => c.classList.toggle('selected', c === b));
    updateHint();
  });

  $('#chips').addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    const id = Number(b.dataset.id);
    if (sel.has(id)) sel.delete(id);
    else sel.add(id);
    b.classList.toggle('selected');
    updateHint();
  });

  $('#t-name').addEventListener('input', (e) => (state.setup.name = e.target.value));

  $('#add-guest').addEventListener('click', addGuest);
  $('#guest-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addGuest(); }
  });

  $('#gen').addEventListener('click', () => {
    const ids = [...state.setup.selected];
    const seed = randSeed();
    const mode = state.setup.mode;
    try {
      const matches = mode === '3v3' ? generateSchedule3v3(ids, seed) : generateSchedule(ids, seed);
      state.draft = { name: state.setup.name.trim(), seed, mode, playerIds: ids, matches };
      state.editing = false;
      renderTurniej();
    } catch (err) {
      toast(err.message, true);
    }
  });

  async function addGuest() {
    const inp = $('#guest-name');
    const name = inp.value.trim();
    if (!name) return;
    try {
      const p = await api.addPlayer(name, true);
      state.players.push(p);
      state.setup.selected.add(p.id);
      renderSetup();
    } catch (err) {
      toast(err.message, true);
    }
  }
}

// --- podgląd harmonogramu (draft) ---
function draftParticipants() {
  const set = new Set(state.draft.playerIds);
  return state.players.filter((p) => set.has(p.id)).map((p) => ({ id: p.id, name: p.name }));
}

function renderDraft() {
  const d = state.draft;
  const parts = draftParticipants();
  const names = nameMap(parts);
  const title = d.name || `Turniej ${fmtDate(new Date().toISOString())}`;

  view.innerHTML = `
    <div class="row spread">
      <h2 style="margin:0">${esc(title)}</h2>
    </div>
    <p class="muted">${d.playerIds.length} graczy • ${d.matches.length} meczów • ${d.mode === '3v3' ? 'każda trójka gra razem raz' : 'każda para gra razem raz'}</p>
    <div class="btn-row">
      <button class="btn btn-ghost" id="reshuffle">🎲 Przelosuj</button>
      <button class="btn btn-ghost" id="toggle-edit">${state.editing ? '✓ Gotowe' : '✏️ Edytuj składy'}</button>
      <button class="btn btn-ghost" id="back">← Wróć</button>
    </div>
    <div id="matches" class="section-gap"></div>
    <button class="btn btn-primary btn-block section-gap" id="start">Rozpocznij turniej</button>
  `;

  renderDraftMatches(names);

  $('#reshuffle').addEventListener('click', () => {
    d.seed = randSeed();
    d.matches = d.mode === '3v3' ? generateSchedule3v3(d.playerIds, d.seed) : generateSchedule(d.playerIds, d.seed);
    renderDraftMatches(names);
  });
  $('#toggle-edit').addEventListener('click', () => {
    state.editing = !state.editing;
    renderDraft();
  });
  $('#back').addEventListener('click', () => {
    state.draft = null;
    state.editing = false;
    renderTurniej();
  });
  $('#start').addEventListener('click', startTournament);
}

function renderDraftMatches(names) {
  const d = state.draft;
  const box = $('#matches');
  const parts = draftParticipants();
  box.innerHTML = d.matches
    .map((m, i) => {
      const byes = sittingOut(m, d.playerIds).map((id) => esc(names.get(id))).join(', ');
      const slot = (team, pos) =>
        state.editing
          ? `<select class="slot-select" data-mi="${i}" data-team="${team}" data-pos="${pos}">
               ${parts.map((p) => `<option value="${p.id}" ${m[team][pos] === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
             </select>`
          : `<div class="names">${esc(names.get(m[team][pos]))}</div>`;
      return `
      <div class="match">
        <div class="match-head"><span class="match-no">Mecz ${i + 1}</span></div>
        <div class="teams">
          <div class="team">${m.teamA.map((_, p) => slot('teamA', p)).join('')}</div>
          <div class="vs">vs</div>
          <div class="team right">${m.teamB.map((_, p) => slot('teamB', p)).join('')}</div>
        </div>
        ${byes ? `<div class="byes">Pauzują: ${byes}</div>` : ''}
      </div>`;
    })
    .join('');

  if (state.editing) {
    $$('.slot-select', box).forEach((s) =>
      s.addEventListener('change', () => {
        onSlotChange(Number(s.dataset.mi), s.dataset.team, Number(s.dataset.pos), Number(s.value));
        renderDraftMatches(names);
      }),
    );
  }
}

// zamiana gracza w slocie: utrzymuje wszystkich różnych graczy w meczu (4 w 2v2, 6 w 3v3)
function onSlotChange(mi, team, pos, newId) {
  const m = state.draft.matches[mi];
  const cur = m[team][pos];
  if (newId === cur) return;
  const slots = [
    ...m.teamA.map((_, p) => ['teamA', p]),
    ...m.teamB.map((_, p) => ['teamB', p]),
  ];
  const found = slots.find(([k, p]) => m[k][p] === newId);
  if (found) m[found[0]][found[1]] = cur; // swap wewnątrz meczu
  m[team][pos] = newId; // (jeśli z ławki — po prostu wchodzi)
}

async function startTournament() {
  const d = state.draft;
  try {
    const created = await api.createTournament({
      name: d.name || null,
      playerIds: d.playerIds,
      matches: d.matches,
      status: 'active',
    });
    state.active = created;
    state.draft = null;
    state.setup = null;
    state.editing = false;
    state.subtab = 'mecze';
    await api.tournaments().then((t) => (state.tournaments = t));
    toast('Turniej rozpoczęty!');
    render();
  } catch (err) {
    toast(err.message, true);
  }
}

// --- aktywny turniej ---
function renderActive() {
  const t = state.active;
  const title = t.name || `Turniej ${fmtDate(t.created_at)}`;
  view.innerHTML = `
    <div class="row spread">
      <h2 style="margin:0">${esc(title)}</h2>
      <button class="btn btn-danger" id="finish">Zakończ</button>
    </div>
    <p class="muted">${t.players.length} graczy • ${t.matches.length} meczów</p>
    <label class="autofill-toggle">
      <input type="checkbox" id="autofill" ${t.auto_fill ? 'checked' : ''} />
      <span>⚡ Auto-uzupełnianie wyników z pokoju HaxBall</span>
    </label>
    <div class="subtabs">
      <div class="subtab ${state.subtab === 'mecze' ? 'active' : ''}" data-sub="mecze">Mecze</div>
      <div class="subtab ${state.subtab === 'tabela' ? 'active' : ''}" data-sub="tabela">Tabela</div>
    </div>
    <div id="sub"></div>
  `;
  $$('.subtab').forEach((s) =>
    s.addEventListener('click', () => {
      state.subtab = s.dataset.sub;
      renderActive();
    }),
  );
  $('#finish').addEventListener('click', finishActive);
  $('#autofill').addEventListener('change', async (e) => {
    const on = e.target.checked;
    try {
      await api.setAutoFill(t.id, on);
      t.auto_fill = on ? 1 : 0;
      if (on) startLivePoll();
      else stopLivePoll();
      toast(on ? 'Auto-uzupełnianie włączone' : 'Auto-uzupełnianie wstrzymane');
    } catch (err) {
      e.target.checked = !on;
      toast(err.message, true);
    }
  });

  if (state.subtab === 'mecze') renderMatches();
  else renderRanking($('#sub'), t.players, t.matches);

  if (t.auto_fill) startLivePoll();
  else stopLivePoll();
}

// --- żywy pop-in wyników z pokoju (polling aktywnego turnieju) ---
let livePoll = null;
function startLivePoll() {
  if (livePoll) return;
  livePoll = setInterval(pollLive, 5000);
}
function stopLivePoll() {
  if (livePoll) { clearInterval(livePoll); livePoll = null; }
}

async function pollLive() {
  if (!state.active || state.tab !== 'turniej') return;
  const id = state.active.id;
  let fresh;
  try {
    fresh = await api.tournament(id);
  } catch (e) {
    return; // sieć/serwer — spróbujemy przy następnym ticku
  }
  if (!state.active || state.active.id !== id) return; // stan zmieniony w międzyczasie
  const local = state.active;
  const changed = [];
  for (const fm of fresh.matches) {
    const lm = local.matches.find((x) => x.id === fm.id);
    if (!lm) continue;
    if (lm.scoreA !== fm.scoreA || lm.scoreB !== fm.scoreB) {
      const wasEmpty = lm.scoreA === null && lm.scoreB === null;
      lm.scoreA = fm.scoreA;
      lm.scoreB = fm.scoreB;
      changed.push({ m: lm, wasEmpty });
    }
  }
  if (!changed.length) return;
  if (state.subtab === 'mecze') applyLiveToInputs(changed);
  else renderRanking($('#sub'), local.players, local.matches);
  const filled = changed.filter((c) => c.wasEmpty && c.m.scoreA !== null);
  if (filled.length) {
    toast('Wynik z pokoju: ' + filled.map((c) => 'Mecz ' + c.m.match_no).join(', '));
  }
}

// Wpisuje wyniki do inputów bez psucia pola, które właśnie edytujesz.
function applyLiveToInputs(changed) {
  const box = $('#sub');
  if (!box) return;
  for (const { m } of changed) {
    const row = box.querySelector(`.match[data-mid="${m.id}"]`);
    if (!row) continue;
    const sa = $('.sa', row);
    const sb = $('.sb', row);
    if (document.activeElement === sa || document.activeElement === sb) continue; // nie nadpisuj ręcznego wpisywania
    sa.value = m.scoreA ?? '';
    sb.value = m.scoreB ?? '';
    const savedEl = $('.match-saved', row);
    if (savedEl) savedEl.style.display = m.scoreA !== null && m.scoreB !== null ? '' : 'none';
    row.classList.add('live-flash');
    setTimeout(() => row.classList.remove('live-flash'), 1500);
  }
}

function renderMatches() {
  const t = state.active;
  const names = nameMap(t.players);
  const box = $('#sub');
  box.innerHTML = t.matches
    .map((m) => {
      const byes = sittingOut(m, t.players.map((p) => p.id)).map((id) => esc(names.get(id))).join(', ');
      const done = m.scoreA !== null && m.scoreB !== null;
      return `
      <div class="match" data-mid="${m.id}">
        <div class="match-head">
          <span class="match-no">Mecz ${m.match_no}</span>
          <span class="match-saved" ${done ? '' : 'style="display:none"'}>✓ zapisano</span>
        </div>
        <div class="teams">
          <div class="team"><div class="names">${m.teamA.map((id) => esc(names.get(id))).join(' & ')}</div></div>
          <div class="vs">vs</div>
          <div class="team right"><div class="names">${m.teamB.map((id) => esc(names.get(id))).join(' & ')}</div></div>
        </div>
        <div class="score-inputs">
          <input type="number" inputmode="numeric" min="0" class="sa" value="${m.scoreA ?? ''}" aria-label="Bramki drużyny A" />
          <span class="score-sep">:</span>
          <input type="number" inputmode="numeric" min="0" class="sb" value="${m.scoreB ?? ''}" aria-label="Bramki drużyny B" />
        </div>
        <div class="error"></div>
      </div>`;
    })
    .join('');

  $$('.match', box).forEach((row) => {
    const mid = Number(row.dataset.mid);
    const sa = $('.sa', row);
    const sb = $('.sb', row);
    const errEl = $('.error', row);
    const savedEl = $('.match-saved', row);
    const onChange = async () => {
      const aRaw = sa.value.trim();
      const bRaw = sb.value.trim();
      if (aRaw === '' && bRaw === '') {
        // wyczyść wynik
        errEl.textContent = '';
        savedEl.style.display = 'none';
        await saveScore(mid, null, null, errEl, savedEl);
        return;
      }
      if (aRaw === '' || bRaw === '') { errEl.textContent = ''; return; }
      const v = validateScore(aRaw, bRaw);
      if (!v.ok) {
        errEl.textContent = v.error;
        savedEl.style.display = 'none';
        return;
      }
      errEl.textContent = '';
      await saveScore(mid, v.a, v.b, errEl, savedEl);
    };
    sa.addEventListener('change', onChange);
    sb.addEventListener('change', onChange);
  });
}

async function saveScore(mid, a, b, errEl, savedEl) {
  try {
    await api.setScore(mid, a, b);
    const m = state.active.matches.find((x) => x.id === mid);
    if (m) { m.scoreA = a; m.scoreB = b; }
    if (a !== null && b !== null) {
      savedEl.style.display = '';
    }
  } catch (err) {
    errEl.textContent = err.message;
  }
}

function renderRanking(box, participants, matches) {
  const rows = computeRanking(participants, matches);
  const medal = (place) => (place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : '');
  box.innerHTML = `
    <div class="table-wrap">
      <table class="rank">
        <thead>
          <tr>
            <th>#</th><th class="name">Gracz</th><th>M</th><th>W</th><th>P</th>
            <th>Pkt</th><th>BZ</th><th>BS</th><th>+/−</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (r) => `
            <tr class="${r.place === 1 ? 'leader' : ''}">
              <td>${r.place}</td>
              <td class="name"><span class="medal">${medal(r.place)}</span>${esc(r.name)}</td>
              <td>${r.played}</td><td>${r.wins}</td><td>${r.losses}</td>
              <td class="pts">${r.points}</td><td>${r.gf}</td><td>${r.ga}</td>
              <td>${r.diff > 0 ? '+' + r.diff : r.diff}</td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>
    <p class="muted" style="font-size:.82rem;margin-top:8px">M=mecze, W=wygrane, P=przegrane, Pkt=punkty, BZ=bramki zdobyte, BS=stracone, +/−=bilans</p>
  `;
}

async function finishActive() {
  const t = state.active;
  const rows = computeRanking(t.players, t.matches);
  const played = t.matches.filter((m) => m.scoreA !== null && m.scoreB !== null).length;
  const winner = rows[0];
  const msg = played < t.matches.length
    ? `Nie wszystkie mecze mają wynik (${played}/${t.matches.length}). Zakończyć mimo to?`
    : `Zakończyć turniej? Zwycięzca: ${winner ? winner.name : '—'}.`;
  if (!confirm(msg)) return;
  try {
    stopLivePoll();
    await api.finishTournament(t.id, winner ? winner.id : null);
    state.active = null;
    await refreshData();
    state.tab = 'historia';
    toast('Turniej zakończony!');
    render();
  } catch (err) {
    toast(err.message, true);
  }
}

// ------------------------------------------------------------------ HISTORIA
async function renderHistoria() {
  if (state.historyDetail) return renderHistoryDetail();
  const finished = state.tournaments.filter((t) => t.status === 'finished');
  view.innerHTML = `
    <h2>Historia turniejów</h2>
    ${
      finished.length === 0
        ? `<div class="empty">Brak zakończonych turniejów.</div>`
        : finished
            .map(
              (t) => `
      <div class="card hist-card" data-id="${t.id}">
        <div>
          <div><b>${esc(t.name || 'Turniej ' + fmtDate(t.created_at))}</b></div>
          <div class="date">${fmtDate(t.finished_at || t.created_at)} • ${t.player_count} graczy</div>
        </div>
        <div class="winner">🏆 ${esc(t.winner_name || '—')}</div>
      </div>`,
            )
            .join('')
    }
  `;
  $$('.hist-card').forEach((c) =>
    c.addEventListener('click', async () => {
      try {
        state.historyDetail = await api.tournament(Number(c.dataset.id));
        renderHistoria();
      } catch (err) {
        toast(err.message, true);
      }
    }),
  );
}

function renderHistoryDetail() {
  const t = state.historyDetail;
  const names = nameMap(t.players);
  view.innerHTML = `
    <button class="btn btn-ghost" id="back">← Historia</button>
    <h2 class="section-gap">${esc(t.name || 'Turniej ' + fmtDate(t.created_at))}</h2>
    <p class="muted">${fmtDate(t.finished_at || t.created_at)} • ${t.players.length} graczy</p>
    <div class="btn-row">
      <button class="btn btn-ghost" id="reopen">↩️ Otwórz od nowa</button>
      <button class="btn btn-danger" id="delete">🗑️ Usuń turniej</button>
    </div>
    <h3 class="section-gap">Tabela końcowa</h3>
    <div id="rank"></div>
    <h3 class="section-gap">Mecze</h3>
    <div id="hmatches"></div>
  `;
  $('#back').addEventListener('click', () => {
    state.historyDetail = null;
    renderHistoria();
  });
  $('#reopen').addEventListener('click', () => reopenFromHistory(t));
  $('#delete').addEventListener('click', () => deleteFromHistory(t));
  renderRanking($('#rank'), t.players, t.matches);

  $('#hmatches').innerHTML = t.matches
    .map((m) => {
      const aWon = m.scoreA !== null && m.scoreB !== null && m.scoreA > m.scoreB;
      const bWon = m.scoreA !== null && m.scoreB !== null && m.scoreB > m.scoreA;
      const sc = m.scoreA !== null && m.scoreB !== null ? `${m.scoreA} : ${m.scoreB}` : '— : —';
      return `
      <div class="match">
        <div class="match-head"><span class="match-no">Mecz ${m.match_no}</span><span>${sc}</span></div>
        <div class="teams">
          <div class="team"><div class="names" style="${aWon ? 'color:var(--green-dark)' : ''}">${m.teamA.map((id) => esc(names.get(id))).join(' & ')}</div></div>
          <div class="vs">vs</div>
          <div class="team right"><div class="names" style="${bWon ? 'color:var(--green-dark)' : ''}">${m.teamB.map((id) => esc(names.get(id))).join(' & ')}</div></div>
        </div>
      </div>`;
    })
    .join('');
}

// Wznów zakończony turniej (wraca do aktywnego, wyniki zostają).
async function reopenFromHistory(t) {
  const label = t.name || 'Turniej ' + fmtDate(t.created_at);
  if (!confirm(`Otworzyć „${label}" od nowa? Wróci do aktywnych z zachowanymi wynikami.`)) return;
  try {
    const active = await api.reopenTournament(t.id);
    state.historyDetail = null;
    state.active = active;
    state.subtab = 'mecze';
    await refreshData();
    state.tab = 'turniej';
    toast('Turniej wznowiony!');
    render();
  } catch (err) {
    toast(err.message, true);
  }
}

// Usuń zakończony turniej (nieodwracalne — kasuje też jego mecze).
async function deleteFromHistory(t) {
  const label = t.name || 'Turniej ' + fmtDate(t.created_at);
  if (!confirm(`Usunąć „${label}"? Tej operacji nie można cofnąć.`)) return;
  try {
    await api.deleteTournament(t.id);
    state.historyDetail = null;
    await refreshData();
    toast('Turniej usunięty.');
    render();
  } catch (err) {
    toast(err.message, true);
  }
}

// ------------------------------------------------------------------ GRACZE
function renderGracze() {
  view.innerHTML = `
    <h2>Gracze</h2>
    <div class="card">
      <div class="row">
        <input id="new-name" type="text" placeholder="Imię / nick" style="flex:1" />
        <label class="row" style="gap:4px"><input type="checkbox" id="new-guest" /> gość</label>
        <button class="btn btn-primary" id="add">Dodaj</button>
      </div>
      <div class="error" id="add-err"></div>
    </div>
    ${
      state.players.length === 0
        ? `<div class="empty">Brak graczy — dodaj pierwszego.</div>`
        : `<ul class="player-list card">
            ${state.players
              .map(
                (p) =>
                  `<li><span>${esc(p.name)}${p.is_guest ? '<span class="guest-tag">gość</span>' : ''}</span>
                   <button class="link-btn" style="color:var(--danger)" data-id="${p.id}">usuń</button></li>`,
              )
              .join('')}
          </ul>`
    }
  `;

  const add = async () => {
    const name = $('#new-name').value.trim();
    const guest = $('#new-guest').checked;
    $('#add-err').textContent = '';
    if (!name) return;
    try {
      const p = await api.addPlayer(name, guest);
      state.players.push(p);
      state.players.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
      renderGracze();
    } catch (err) {
      $('#add-err').textContent = err.message;
    }
  };
  $('#add').addEventListener('click', add);
  $('#new-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });

  $$('[data-id]', view).forEach((b) =>
    b.addEventListener('click', async () => {
      const id = Number(b.dataset.id);
      if (!confirm('Usunąć gracza z listy?')) return;
      try {
        await api.archivePlayer(id);
        state.players = state.players.filter((p) => p.id !== id);
        renderGracze();
      } catch (err) {
        toast(err.message, true);
      }
    }),
  );
}

// ------------------------------------------------------------------ STATYSTYKI
const STAT_SUBS = [
  ['ranking', 'Ranking'],
  ['mecze', 'Mecze'],
  ['gracz', 'Gracz'],
  ['h2h', 'H2H'],
  ['dni', 'Dni'],
  ['kategorie', 'Kategorie'],
  ['aliasy', 'Aliasy'],
];

function fmtUnix(sec) {
  const d = new Date(sec * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
const signed = (n) => (n > 0 ? '+' + n : String(n));
// Czas gola jako minuta:sekunda (np. 128s -> 2:08).
function mmss(sec) {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

async function loadStats() {
  const raw = await api.stats();
  state.statsRaw = raw;
  state.statsMatches = stats.resolveMatches(raw.matches, stats.aliasMap(raw.aliases));
}

// Mecze liczone do globalnych statystyk (bez 1v1/2v1 i bez treningowych).
// Historia meczów używa pełnej listy.
function countedStats() {
  return stats.counted(state.statsMatches).filter((m) => !m.is_training);
}

function statPlayerNames() {
  const s = new Set();
  for (const m of countedStats()) {
    m.red.forEach((n) => s.add(n));
    m.blue.forEach((n) => s.add(n));
  }
  return [...s].sort((a, b) => a.localeCompare(b, 'pl'));
}

async function renderStatystyki() {
  if (state.statsRaw === null) {
    view.innerHTML = `<div class="empty">Ładowanie statystyk…</div>`;
    try {
      await loadStats();
    } catch (e) {
      view.innerHTML = `<div class="empty">Nie udało się pobrać statystyk: ${esc(e.message)}</div>`;
      return;
    }
  }
  drawStatsShell();
}

function drawStatsShell() {
  view.innerHTML = `
    <div class="row spread">
      <h2 style="margin:0">Statystyki</h2>
      <button class="link-btn" id="stats-refresh" style="color:var(--green-dark)" title="Odśwież">↻ Odśwież</button>
    </div>
    <div class="subtabs stats-subtabs">
      ${STAT_SUBS.map(([k, l]) => `<div class="subtab ${state.statsSub === k ? 'active' : ''}" data-sub="${k}">${l}</div>`).join('')}
    </div>
    <div id="statsbody"></div>
  `;
  $$('.stats-subtabs .subtab').forEach((s) =>
    s.addEventListener('click', () => {
      state.statsSub = s.dataset.sub;
      drawStatsShell();
    }),
  );
  $('#stats-refresh').addEventListener('click', async () => {
    state.statsRaw = null;
    await renderStatystyki();
  });
  renderStatsSub();
}

function renderStatsSub() {
  const box = $('#statsbody');
  if (!state.statsMatches.length && state.statsSub !== 'aliasy') {
    box.innerHTML = `<div class="empty">Brak meczów. Włącz tampera w pokoju HaxBall albo wpisz wyniki w turnieju.</div>`;
    return;
  }
  if (state.statsSub === 'ranking') return renderStatRanking(box);
  if (state.statsSub === 'mecze') return renderStatMatches(box);
  if (state.statsSub === 'gracz') return renderStatPlayer(box);
  if (state.statsSub === 'h2h') return renderStatH2H(box);
  if (state.statsSub === 'dni') return renderStatDays(box);
  if (state.statsSub === 'kategorie') return renderStatCategories(box);
  if (state.statsSub === 'aliasy') return renderStatAliases(box);
}

function goToPlayer(name) {
  state.statsPlayer = name;
  state.statsSub = 'gracz';
  drawStatsShell();
}

// --- Ranking (leaderboard globalny) ---
// Kolumny sortowalne klikiem nagłówka. Domyślnie ELO ↓.
const RANK_COLS = [
  ['elo', 'Elo', 'desc'],
  ['matches', 'M', 'desc'],
  ['wins', 'W', 'desc'],
  ['losses', 'P', 'desc'],
  ['gf', 'BZ', 'desc'],
  ['ga', 'BS', 'desc'],
  ['goal_diff', '+/−', 'desc'],
];

function renderStatRanking(box) {
  const cats = stats.categories(countedStats());
  const rows = stats.leaderboard(countedStats(), { day: state.statsDay, category: state.statsCat });
  const medal = (p) => (p === 1 ? '🥇' : p === 2 ? '🥈' : p === 3 ? '🥉' : '');

  const { col, dir } = state.statsSort;
  const mul = dir === 'asc' ? 1 : -1;
  rows.sort((x, y) => {
    const a = x[col], b = y[col];
    if (a !== b) return a < b ? -1 * mul : 1 * mul;
    return String(x.name).localeCompare(String(y.name), 'pl');
  });
  const arrow = (c) => (col === c ? (dir === 'asc' ? ' ▲' : ' ▼') : '');

  box.innerHTML = `
    <div class="chips" style="margin-bottom:12px">
      <button class="chip ${state.statsCat === null ? 'selected' : ''}" data-cat="">Wszystkie</button>
      ${cats.map((c) => `<button class="chip ${state.statsCat === c.category ? 'selected' : ''}" data-cat="${esc(c.category)}">${esc(c.category)} <span class="badge">${c.matches}</span></button>`).join('')}
    </div>
    ${state.statsDay ? `<p class="muted">Filtr dnia: <b>${state.statsDay}</b> <button class="link-btn" id="clear-day" style="color:var(--danger)">✕ wyczyść</button></p>` : ''}
    <div class="table-wrap">
      <table class="rank">
        <thead>
          <tr>
            <th>#</th><th class="name">Gracz</th>
            ${RANK_COLS.map(([c, l]) => `<th class="sortable ${col === c ? 'sorted' : ''}" data-col="${c}">${l}${arrow(c)}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (r, i) => `
            <tr class="${i === 0 ? 'leader' : ''}">
              <td>${i + 1}</td>
              <td class="name"><span class="medal">${medal(i + 1)}</span><a class="pname" data-name="${esc(r.name)}">${esc(r.name)}</a></td>
              <td class="pts">${r.elo}</td>
              <td>${r.matches}</td><td>${r.wins}</td><td>${r.losses}</td>
              <td>${r.gf}</td><td>${r.ga}</td>
              <td>${signed(r.goal_diff)}</td>
            </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    </div>
    <p class="muted" style="font-size:.82rem;margin-top:8px">Elo (ranking), M=mecze, W/P=wygrane/przegrane, BZ/BS=bramki zdobyte/stracone (jako drużyna), +/−=bilans. Kliknij nagłówek by sortować. Mecze 1v1/2v1 nie są liczone.</p>
  `;
  $$('.chip[data-cat]', box).forEach((c) =>
    c.addEventListener('click', () => {
      state.statsCat = c.dataset.cat === '' ? null : c.dataset.cat;
      renderStatRanking(box);
    }),
  );
  $$('th.sortable', box).forEach((th) =>
    th.addEventListener('click', () => {
      const c = th.dataset.col;
      if (state.statsSort.col === c) {
        state.statsSort.dir = state.statsSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.statsSort.col = c;
        state.statsSort.dir = RANK_COLS.find((x) => x[0] === c)[2];
      }
      renderStatRanking(box);
    }),
  );
  $$('.pname', box).forEach((a) => a.addEventListener('click', () => goToPlayer(a.dataset.name)));
  const cd = $('#clear-day', box);
  if (cd) cd.addEventListener('click', () => { state.statsDay = null; renderStatRanking(box); });
}

// --- Historia meczów (rozwijalne gole) ---
function renderStatMatches(box) {
  const ms = [...state.statsMatches].sort((a, b) => b.started_at - a.started_at);
  const teamHtml = (names, cls) =>
    `<span class="${cls}">${names.map((n) => `<a class="pname">${esc(n)}</a>`).join(' & ')}</span>`;
  box.innerHTML = ms
    .map((m) => {
      const open = state.statsExpanded.has(m.id);
      const src = m.source === 'live' ? '<span class="src-badge live">na żywo</span>' : '<span class="src-badge">turniej</span>';
      const uncounted = !(m.red.length >= 2 && m.blue.length >= 2)
        ? '<span class="src-badge">nieliczony</span>' : '';
      const training = m.is_training ? '<span class="src-badge">treningowy</span>' : '';
      const goals = m.goals.length
        ? `<div class="goal-list">${m.goals
            .map((g) => `<div class="goal ${g.team}">${mmss(g.time)} • ${g.own_goal ? 'samobój' : (g.scorer ? esc(g.scorer) : 'gol')}${g.assist ? ' (as. ' + esc(g.assist) + ')' : ''}</div>`)
            .join('')}</div>`
        : `<div class="muted" style="font-size:.85rem;margin-top:8px">Brak szczegółów goli.</div>`;
      const toggle = m.source === 'live'
        ? `<button class="link-btn train-match" data-id="${m.id}" data-train="${m.is_training ? 0 : 1}" style="color:var(--green-dark)">${m.is_training ? 'oznacz oficjalny' : 'oznacz treningowy'}</button>`
        : '';
      return `
      <div class="match" data-mid="${m.id}">
        <div class="match-head">
          <span class="match-no">${fmtUnix(m.started_at)} ${src}${uncounted}${training}</span>
          <span>${toggle}</span>
        </div>
        <div class="teams">
          <div class="team">${teamHtml(m.red, m.winner === 'red' ? 'names win' : 'names')}</div>
          <div class="vs">${m.red_score} : ${m.blue_score}</div>
          <div class="team right">${teamHtml(m.blue, m.winner === 'blue' ? 'names win' : 'names')}</div>
        </div>
        <button class="link-btn toggle-goals" data-id="${m.id}" style="color:var(--green-dark);margin-top:6px">${open ? 'ukryj' : 'szczegóły'}</button>
        ${open ? goals : ''}
      </div>`;
    })
    .join('');

  $$('.toggle-goals', box).forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.id;
      if (state.statsExpanded.has(id)) state.statsExpanded.delete(id);
      else state.statsExpanded.add(id);
      renderStatMatches(box);
    }),
  );
  $$('.pname', box).forEach((a) => a.addEventListener('click', () => goToPlayer(a.textContent)));
  $$('.train-match', box).forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await api.setStatMatchTraining(Number(b.dataset.id.slice(1)), b.dataset.train === '1'); // 'L<n>' -> n
        await loadStats();
        renderStatMatches(box);
      } catch (err) {
        toast(err.message, true);
      }
    }),
  );
}

// --- Profil gracza ---
function renderStatPlayer(box) {
  const names = statPlayerNames();
  if (!state.statsPlayer && names.length) state.statsPlayer = names[0];
  const detail = state.statsPlayer ? stats.playerDetail(countedStats(), state.statsPlayer) : null;

  const tiles = detail
    ? [
        ['Elo', detail.stats.elo],
        ['Mecze', detail.stats.matches],
        ['Wygrane', detail.stats.wins],
        ['Przegrane', detail.stats.losses],
        ['Win%', Math.round(detail.stats.win_rate * 100) + '%'],
        ['Gole', detail.stats.goals],
        ['Asysty', detail.stats.assists],
        ['Bilans', signed(detail.stats.goal_diff)],
      ]
    : [];

  const mates = state.statsPlayer ? stats.teammates(countedStats(), state.statsPlayer) : [];

  box.innerHTML = `
    <div class="card">
      <label class="muted">Gracz</label>
      <select id="ppick" style="width:100%;margin-top:6px">
        ${names.map((n) => `<option value="${esc(n)}" ${n === state.statsPlayer ? 'selected' : ''}>${esc(n)}</option>`).join('')}
      </select>
    </div>
    ${
      !detail
        ? `<div class="empty">Brak danych gracza.</div>`
        : `
    <div class="stat-tiles">
      ${tiles.map(([l, v]) => `<div class="stat-tile"><div class="stat-l">${l}</div><div class="stat-v">${v}</div></div>`).join('')}
    </div>
    <h3 class="section-gap">Ostatnie mecze</h3>
    <div>
      ${detail.recent_matches
        .slice(0, 20)
        .map(
          (m) => `
        <div class="match">
          <div class="match-head"><span class="match-no">${fmtUnix(m.started_at)}</span>
            <span style="color:${m.won ? 'var(--green)' : 'var(--danger)'}">${m.won ? 'W' : 'P'}</span></div>
          <div class="teams">
            <div class="team"><div class="names ${m.winner === 'red' ? 'win' : ''}">${m.red.map(esc).join(' & ')}</div></div>
            <div class="vs">${m.red_score} : ${m.blue_score}</div>
            <div class="team right"><div class="names ${m.winner === 'blue' ? 'win' : ''}">${m.blue.map(esc).join(' & ')}</div></div>
          </div>
        </div>`,
        )
        .join('')}
    </div>
    <h3 class="section-gap">Partnerzy</h3>
    ${
      mates.length === 0
        ? `<div class="muted">Brak historii wspólnych gier.</div>`
        : `<div class="table-wrap"><table class="rank">
            <thead><tr><th class="name">Partner</th><th>Gry</th><th>Wygrane</th><th>Win%</th></tr></thead>
            <tbody>${mates
              .map(
                (t) =>
                  `<tr><td class="name"><a class="pname" data-name="${esc(t.partner)}">${esc(t.partner)}</a></td><td>${t.games}</td><td>${t.wins}</td><td>${Math.round(t.win_rate * 100)}%</td></tr>`,
              )
              .join('')}</tbody></table></div>`
    }
    `
    }
  `;
  const pick = $('#ppick', box);
  if (pick) pick.addEventListener('change', () => { state.statsPlayer = pick.value; renderStatPlayer(box); });
  $$('.pname', box).forEach((a) => a.addEventListener('click', () => { state.statsPlayer = a.dataset.name; renderStatPlayer(box); }));
}

// --- Head-to-head ---
function renderStatH2H(box) {
  const names = statPlayerNames();
  if (!state.h2hA && names.length) state.h2hA = names[0];
  if (!state.h2hB && names.length > 1) state.h2hB = names[1];
  const sel = (id, val) =>
    `<select id="${id}" style="flex:1">${names.map((n) => `<option value="${esc(n)}" ${n === val ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>`;
  const r = state.h2hA && state.h2hB ? stats.headToHead(countedStats(), state.h2hA, state.h2hB) : null;
  box.innerHTML = `
    <div class="card">
      <div class="row">${sel('h2h-a', state.h2hA)}<span class="vs">vs</span>${sel('h2h-b', state.h2hB)}</div>
    </div>
    ${
      !r
        ? `<div class="empty">Wybierz dwóch graczy.</div>`
        : r.a === r.b
        ? `<div class="empty">Wybierz dwóch różnych graczy.</div>`
        : `<div class="card">
            <p class="muted">Mecze po przeciwnych stronach: <b>${r.games}</b></p>
            <div class="teams" style="align-items:stretch">
              <div class="stat-tile" style="flex:1"><div class="stat-l">${esc(r.a)}</div><div class="stat-v">${r.a_wins}</div></div>
              <div class="vs">:</div>
              <div class="stat-tile" style="flex:1"><div class="stat-l">${esc(r.b)}</div><div class="stat-v">${r.b_wins}</div></div>
            </div>
          </div>`
    }
  `;
  const a = $('#h2h-a', box);
  const b = $('#h2h-b', box);
  if (a) a.addEventListener('change', () => { state.h2hA = a.value; renderStatH2H(box); });
  if (b) b.addEventListener('change', () => { state.h2hB = b.value; renderStatH2H(box); });
}

// --- Dni ---
function renderStatDays(box) {
  const rows = stats.days(countedStats(), state.statsCat);
  box.innerHTML = rows.length === 0
    ? `<div class="empty">Brak dni.</div>`
    : rows
        .map(
          (d) => `
      <div class="card hist-card day-card" data-day="${d.date}">
        <div><div><b>${d.date}</b></div><div class="date">${d.matches} meczów</div></div>
        <div class="winner">🏆 ${esc(d.champion || '—')}</div>
      </div>`,
        )
        .join('');
  $$('.day-card', box).forEach((c) =>
    c.addEventListener('click', () => {
      state.statsDay = c.dataset.day;
      state.statsSub = 'ranking';
      drawStatsShell();
    }),
  );
}

// --- Kategorie ---
function renderStatCategories(box) {
  const rows = stats.categories(countedStats());
  box.innerHTML = `<div class="table-wrap"><table class="rank">
    <thead><tr><th class="name">Kategoria</th><th>Mecze</th></tr></thead>
    <tbody>${rows.map((c) => `<tr><td class="name">${esc(c.category)}</td><td>${c.matches}</td></tr>`).join('')}</tbody>
  </table></div>`;
}

// --- Aliasy (scalanie nicków) ---
function renderStatAliases(box) {
  const aliases = state.statsRaw.aliases || [];
  const names = statPlayerNames();
  box.innerHTML = `
    <div class="card">
      <h3>Scal nicki</h3>
      <p class="muted" style="font-size:.85rem">Gracz zmienił nick? Wskaż stary → aktualny. Statystyki łączą się pod aktualnym. Odwracalne — nie zmienia zapisów meczów.</p>
      <datalist id="nick-list">${names.map((n) => `<option value="${esc(n)}"></option>`).join('')}</datalist>
      <div class="row" style="margin-top:8px">
        <input id="al-old" list="nick-list" placeholder="Stary nick" style="flex:1" />
        <span class="vs">→</span>
        <input id="al-new" list="nick-list" placeholder="Aktualny nick" style="flex:1" />
        <button class="btn btn-primary" id="al-add">Scal</button>
      </div>
      <div class="error" id="al-err"></div>
    </div>
    ${
      aliases.length === 0
        ? `<div class="muted">Brak scaleń.</div>`
        : `<ul class="player-list card">${aliases
            .map(
              (a) =>
                `<li><span>${esc(a.alias)} <span class="vs">→</span> <b>${esc(a.canonical)}</b></span><button class="link-btn al-del" data-alias="${esc(a.alias)}" style="color:var(--danger)">✕</button></li>`,
            )
            .join('')}</ul>`
    }
  `;
  $('#al-add', box).addEventListener('click', async () => {
    const oldN = $('#al-old', box).value.trim();
    const newN = $('#al-new', box).value.trim();
    $('#al-err', box).textContent = '';
    if (!oldN || !newN) { $('#al-err', box).textContent = 'Podaj oba nicki.'; return; }
    try {
      await api.addAlias(oldN, newN);
      state.statsRaw = null;
      await loadStats();
      drawStatsShell();
    } catch (err) {
      $('#al-err', box).textContent = err.message;
    }
  });
  $$('.al-del', box).forEach((b) =>
    b.addEventListener('click', async () => {
      try {
        await api.deleteAlias(b.dataset.alias);
        state.statsRaw = null;
        await loadStats();
        drawStatsShell();
      } catch (err) {
        toast(err.message, true);
      }
    }),
  );
}

// ------------------------------------------------------------------ start
init();
