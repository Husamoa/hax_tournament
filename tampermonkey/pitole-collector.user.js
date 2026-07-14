// ==UserScript==
// @name         Pitole Collector
// @namespace    pitole
// @version      1.0
// @description  Nasłuchuje pokoju HaxBall w przeglądarce i wysyła zakończone mecze do Pitole (endpoint ?r=ingest). Cykl życia sterowany logiem pokoju ("Game started by ...", "Game stopped by ...", "<Team> team won"). Łapie składy, wynik i czas. Strzelca/asysty nie da się odczytać z DOM — wysyłane jako null. Backend auto-linkuje mecz do aktywnego turnieju i wpisuje wynik.
// @match        *://*.haxball.com/*
// @run-at       document-start
// @all-frames   true
// @grant        GM_xmlhttpRequest
// @connect      pitole.pl
// @connect      localhost
// @connect      127.0.0.1
// ==/UserScript==

(function () {
  "use strict";

  // === KONFIGURACJA ===
  // Adres aplikacji Pitole (BEZ końcowego /). Lokalnie: "http://127.0.0.1:8099".
  // Produkcja: "https://pitole.pl". Jeśli zmienisz domenę — dopisz ją też w @connect wyżej.
  const BASE = "http://localhost:8090";
  const INGEST = BASE + "/api/index.php?r=ingest";

  // Gra działa w iframe (game.html) bez ?c=; token pokoju jest w ramce nadrzędnej (ten sam
  // origin: www.haxball.com) — bierzemy go stamtąd w razie potrzeby.
  function readRoomId() {
    let s = location.search;
    try { if (window.top && window.top.location) s = s || window.top.location.search; } catch (e) {}
    return (s.match(/[?&]c=([^&]+)/) || [])[1] || "unknown";
  }
  const ROOM = readRoomId();
  const log = (...a) => console.log("[pitole]", ...a);

  let match = null; // {startedAt, red[], blue[], goals[], lastR, lastB}
  let lastRosters = { red: [], blue: [] }; // ostatni czytelny skład (panel widać tylko gdy gra stoi)

  // --- odczyt DOM -----------------------------------------------------------
  // Tablica wyniku: mały element którego tekst zaczyna się "<red>-<blue>" i ma zegar mm:ss.
  function readScore() {
    for (const el of document.querySelectorAll("div,span,p")) {
      if (el.children.length > 6) continue;
      const t = (el.textContent || "").trim();
      const m = t.match(/^(\d+)\s*-\s*(\d+)/);
      if (m && /\d{1,2}:\d{2}/.test(t) && t.length < 40) {
        const c = t.match(/(\d{1,2}):(\d{2})/);
        return { r: +m[1], b: +m[2], sec: c ? +c[1] * 60 + +c[2] : 0 };
      }
    }
    return null;
  }

  // Panel drużyn: "...Reset Red <gracze> Spectators <gracze> Blue <gracze> Time limit...".
  // Idziemy w kolejności dokumentu; kolumnę zmieniają nagłówki Red/Spectators/Blue;
  // liście między nagłówkami to gracze (obcinamy końcowe cyfry poziomu).
  function readRosters() {
    let panel = null;
    for (const el of document.querySelectorAll("div")) {
      const t = el.textContent || "";
      if (t.includes("Time limit") && t.includes("Score limit") && t.includes("Stadium") && t.includes("Blue")) {
        panel = el; // najgłębszy pasujący kontener (kolejność dokumentu trzyma przodków pierwszych)
      }
    }
    if (!panel) return null;

    const red = [], blue = [];
    let col = null;
    (function walk(node) {
      for (const child of node.children) {
        const txt = (child.textContent || "").trim();
        if (txt === "Red") { col = red; continue; }
        if (txt === "Blue") { col = blue; continue; }
        if (txt === "Spectators") { col = null; continue; }
        if (txt === "Time limit" || txt === "Score limit" || txt === "Stadium") { col = null; }
        if (child.children.length === 0) {
          if (col && txt) {
            const name = txt.replace(/\d+$/, "").trim(); // obetnij badge poziomu
            if (name) col.push(name);
          }
        } else {
          walk(child);
        }
      }
    })(panel);

    return { red: [...new Set(red)], blue: [...new Set(blue)] };
  }

  // --- cykl życia -----------------------------------------------------------
  function begin() {
    match = {
      startedAt: Date.now() / 1000,
      red: [...lastRosters.red],
      blue: [...lastRosters.blue],
      goals: [],
      lastR: 0,
      lastB: 0,
    };
    log("START. red=", match.red, "blue=", match.blue);
  }

  function onScore(score) {
    if (!match) return;
    while (score.r > match.lastR) {
      match.lastR++;
      match.goals.push({ time: score.sec, team: "red", scorer: null, assist: null, own_goal: false });
      log("gol RED", match.lastR + "-" + match.lastB, "t=" + score.sec);
    }
    while (score.b > match.lastB) {
      match.lastB++;
      match.goals.push({ time: score.sec, team: "blue", scorer: null, assist: null, own_goal: false });
      log("gol BLUE", match.lastR + "-" + match.lastB, "t=" + score.sec);
    }
  }

  function cancel() {
    if (!match) return;
    log("ANULOWANY (gra zatrzymana przed zwycięstwem), nie liczony.");
    match = null;
  }

  function finish(winner) {
    if (!match) return;
    const endedAt = Date.now() / 1000;
    const payload = {
      room: ROOM,
      started_at: match.startedAt,
      ended_at: endedAt,
      duration_sec: endedAt - match.startedAt,
      red_score: match.lastR,
      blue_score: match.lastB,
      winner,
      red: match.red,
      blue: match.blue,
      goals: match.goals,
    };
    match = null;
    log("KONIEC. zwycięzca=" + winner, "wysyłam:", payload);
    post(payload);
  }

  function post(payload) {
    if (!payload.red.length || !payload.blue.length) {
      window.__lastMatch = payload;
      log("POMIJAM wysyłkę: pusty skład (nie udało się odczytać drużyn). Sprawdź window.__lastMatch.");
      return;
    }
    GM_xmlhttpRequest({
      method: "POST",
      url: INGEST,
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify(payload),
      onload: (res) => log("POST", res.status, res.responseText),
      onerror: (err) => log("POST błąd", err.error || err.statusText || "", "status=" + err.status, "-> sprawdź BASE (" + INGEST + ") i czy backend działa"),
    });
  }

  // --- pętle ----------------------------------------------------------------
  // Poll: odświeżaj składy (panel widać tylko gdy gra stoi) + zliczaj gole gdy gra trwa.
  setInterval(() => {
    const r = readRosters();
    if (r && (r.red.length || r.blue.length)) lastRosters = r;
    if (match) {
      const s = readScore();
      if (s) onScore(s);
    }
  }, 500);

  // Cykl życia z linii logu pokoju.
  const mo = new MutationObserver((records) => {
    for (const rec of records) {
      for (const n of rec.addedNodes) {
        const t = (n.textContent || "").trim();
        if (!t) continue;
        if (/Game started by /i.test(t)) begin();
        else if (/Game stopped by /i.test(t)) cancel();
        else {
          const v = t.match(/(Red|Blue) team (?:won|wins|is victorious)/i);
          if (v) finish(v[1].toLowerCase());
        }
      }
    }
  });
  (function start() {
    if (document.body) mo.observe(document.body, { childList: true, subtree: true });
    else setTimeout(start, 200);
  })();

  log("kolektor gotowy. pokój=" + ROOM, "backend=" + BASE);
})();
