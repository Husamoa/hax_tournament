import { api } from './api.js';
import { generateSchedule, sittingOut, expectedMatchCount } from './schedule.js';
import { computeRanking, validateScore } from './ranking.js';

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
  // nawigacja (raz)
  $$('.tab').forEach((b) =>
    b.addEventListener('click', () => {
      state.tab = b.dataset.tab;
      state.historyDetail = null;
      render();
    }),
  );
  $('#logout-btn').addEventListener('click', async () => {
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
  if (!state.setup) state.setup = { name: '', selected: new Set() };
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
    <button class="btn btn-primary btn-block" id="gen" ${n < 4 ? 'disabled' : ''}>Generuj harmonogram</button>
    `
    }
  `;

  if (roster.length === 0) return;

  const updateHint = () => {
    const k = state.setup.selected.size;
    const hint = $('#hint');
    if (k < 4) hint.textContent = `Wybrano ${k} — potrzeba minimum 4.`;
    else hint.textContent = `Wybrano ${k} graczy • ${expectedMatchCount(k)} meczów`;
    $('#gen').disabled = k < 4;
  };
  updateHint();

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
    try {
      const matches = generateSchedule(ids, seed);
      state.draft = { name: state.setup.name.trim(), seed, playerIds: ids, matches };
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
    <p class="muted">${d.playerIds.length} graczy • ${d.matches.length} meczów • każda para gra razem raz</p>
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
    d.matches = generateSchedule(d.playerIds, d.seed);
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
          <div class="team">${slot('teamA', 0)}${slot('teamA', 1)}</div>
          <div class="vs">vs</div>
          <div class="team right">${slot('teamB', 0)}${slot('teamB', 1)}</div>
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

// zamiana gracza w slocie: utrzymuje 4 różnych graczy w meczu
function onSlotChange(mi, team, pos, newId) {
  const m = state.draft.matches[mi];
  const cur = m[team][pos];
  if (newId === cur) return;
  const slots = [['teamA', 0], ['teamA', 1], ['teamB', 0], ['teamB', 1]];
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

  if (state.subtab === 'mecze') renderMatches();
  else renderRanking($('#sub'), t.players, t.matches);
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
          <div class="team"><div class="names">${esc(names.get(m.teamA[0]))} & ${esc(names.get(m.teamA[1]))}</div></div>
          <div class="vs">vs</div>
          <div class="team right"><div class="names">${esc(names.get(m.teamB[0]))} & ${esc(names.get(m.teamB[1]))}</div></div>
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
    <h3 class="section-gap">Tabela końcowa</h3>
    <div id="rank"></div>
    <h3 class="section-gap">Mecze</h3>
    <div id="hmatches"></div>
  `;
  $('#back').addEventListener('click', () => {
    state.historyDetail = null;
    renderHistoria();
  });
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
          <div class="team"><div class="names" style="${aWon ? 'color:var(--green-dark)' : ''}">${esc(names.get(m.teamA[0]))} & ${esc(names.get(m.teamA[1]))}</div></div>
          <div class="vs">vs</div>
          <div class="team right"><div class="names" style="${bWon ? 'color:var(--green-dark)' : ''}">${esc(names.get(m.teamB[0]))} & ${esc(names.get(m.teamB[1]))}</div></div>
        </div>
      </div>`;
    })
    .join('');
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

// ------------------------------------------------------------------ start
init();
