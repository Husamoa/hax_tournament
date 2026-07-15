"use strict";

// Pitole — host pokoju HaxBall (headless, 24/7) + zbieracz wyników.
//
// Tworzy pokój przez node-haxball (Room.create — bez przeglądarki), śledzi mecz (składy,
// gole ze strzelcem/asystą, samobóje, zwycięzcę) i po zwycięstwie wysyła wynik do Pitole
// (POST ?r=ingest). Backend auto-linkuje mecz do aktywnego turnieju i wpisuje wynik.
//
// UWAGA: dokładne API node-haxball (Room.create / nazwy callbacków / odczyt piłki i graczy)
// zweryfikuj z wiki: https://github.com/wxyz-abcd/node-haxball/wiki — bywa zależne od wersji.

// --- prosty loader .env (bez zależności) ---
const fs = require("fs");
const path = require("path");
(function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
})();

const HAX_TOKEN = process.env.HAX_TOKEN;
const ROOM_NAME = process.env.ROOM_NAME || "Pitole 2v2";
const ROOM_PASSWORD = process.env.ROOM_PASSWORD || null;
const ROOM_PUBLIC = (process.env.ROOM_PUBLIC || "true").toLowerCase() !== "false";
const MAX_PLAYERS = parseInt(process.env.MAX_PLAYERS || "10", 10);
const BACKEND_URL = (process.env.BACKEND_URL || "https://pitole.pl").replace(/\/+$/, "");
const INGEST_URL = BACKEND_URL + "/api/index.php?r=ingest";
const RECONNECT_DELAY_MS = 5000;

if (!HAX_TOKEN) {
  console.error("Brak HAX_TOKEN. Pobierz z https://www.haxball.com/headlesstoken i wpisz do bot/.env.");
  process.exit(1);
}

const { Room, RoomConfig, AllowFlags, Utils, Impl } = require("node-haxball")();
const Team = Impl.Core.Team; // Team.spec.id === 0, Team.red.id === 1, Team.blue.id === 2

let match = null; // null gdy żaden mecz nie trwa

function teamName(teamId) {
  return teamId === Team.red.id ? "red" : teamId === Team.blue.id ? "blue" : null;
}

// --- śledzenie meczu (logika jak w bot.js z haxstats) ---
function beginMatch(room) {
  const red = room.players.filter((p) => p.team.id === Team.red.id).map((p) => p.name);
  const blue = room.players.filter((p) => p.team.id === Team.blue.id).map((p) => p.name);
  match = { startedAt: Date.now() / 1000, red, blue, goals: [], touches: [], posted: false };
  console.log(`[mecz] start. red=[${red.join(", ")}] blue=[${blue.join(", ")}]`);
}

function recordTouch(name) {
  const last = match.touches[match.touches.length - 1];
  if (last && last.name === name) return; // zlej powtórki
  match.touches.push({ name });
}

function detectTouches(room) {
  const ball = room.getBall();
  if (!ball || !ball.pos) return;
  for (const player of room.players) {
    if (player.team.id !== Team.red.id && player.team.id !== Team.blue.id) continue;
    const disc = room.getPlayerDisc(player.id);
    if (!disc || !disc.pos) continue;
    const dx = disc.pos.x - ball.pos.x;
    const dy = disc.pos.y - ball.pos.y;
    const touch = disc.radius + ball.radius;
    if (dx * dx + dy * dy <= touch * touch) {
      recordTouch(player.name);
    }
  }
}

function teamOfPlayer(room, name) {
  const p = room.players.find((x) => x.name === name);
  return p ? p.team.id : null;
}

function handleGoal(room, teamId) {
  const time = (room.timeElapsed != null ? room.timeElapsed : 0) / 1000;
  const touches = match.touches;
  const last = touches[touches.length - 1];

  let scorer = null, assist = null, ownGoal = false;
  if (last) {
    const lastTeam = teamOfPlayer(room, last.name);
    if (lastTeam != null && lastTeam !== teamId) {
      scorer = last.name; // ostatni dotykający bronił — samobój
      ownGoal = true;
    } else {
      scorer = last.name;
      for (let i = touches.length - 2; i >= 0; i--) {
        const t = touches[i];
        if (teamOfPlayer(room, t.name) === teamId && t.name !== scorer) { assist = t.name; break; }
      }
    }
  }

  match.goals.push({ time, team: teamName(teamId), scorer, assist, own_goal: ownGoal });
  console.log(`[gol] team=${teamName(teamId)} strzelec=${scorer} asysta=${assist} samobój=${ownGoal} t=${time.toFixed(1)}s`);
  match.touches = [];
}

async function postMatch(room, winningTeamId) {
  const endedAt = Date.now() / 1000;
  const payload = {
    room: room.name || ROOM_NAME,
    started_at: match.startedAt,
    ended_at: endedAt,
    duration_sec: endedAt - match.startedAt,
    red_score: room.redScore != null ? room.redScore : 0,
    blue_score: room.blueScore != null ? room.blueScore : 0,
    winner: teamName(winningTeamId),
    red: match.red,
    blue: match.blue,
    goals: match.goals,
  };
  try {
    const res = await fetch(INGEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) { console.error(`[mecz] POST nieudany: ${res.status} ${await res.text()}`); return; }
    const data = await res.json();
    console.log(`[mecz] zapisany. id=${data.id} counted=${data.counted} linked=${data.linked}`);
  } catch (err) {
    console.error(`[mecz] POST błąd: ${err.message} (sprawdź BACKEND_URL=${BACKEND_URL})`);
  }
}

// --- konfiguracja pokoju ---
function HostConfig() {
  RoomConfig.call(this, {
    name: "pitole-host",
    version: "1.0",
    author: "pitole",
    description: "Hostuje pokój Pitole i wysyła wyniki do statystyk.",
    allowFlags: AllowFlags.CreateRoom | AllowFlags.JoinRoom,
  });
  const self = this;

  // pierwszy gracz dostaje admina (żeby ktoś mógł ruszać składy i startować mecze)
  this.onPlayerJoin = function (playerObj) {
    console.log(`[gracz] wszedł: ${playerObj.name}`);
    const hasAdmin = self.room.players.some((p) => p.isAdmin);
    if (!hasAdmin) self.room.setPlayerAdmin(playerObj.id, true);
  };
  this.onPlayerLeave = function (playerObj) {
    console.log(`[gracz] wyszedł: ${playerObj.name}`);
    // gdy admin wyszedł — nadaj pierwszemu pozostałemu
    const rest = self.room.players.filter((p) => p.id !== playerObj.id);
    if (rest.length && !rest.some((p) => p.isAdmin)) self.room.setPlayerAdmin(rest[0].id, true);
  };

  this.onGameStart = function () { beginMatch(self.room); };
  this.onGameTick = function () { if (match) detectTouches(self.room); };
  this.onTeamGoal = function (teamId) { if (match) handleGoal(self.room, teamId); };
  this.onGameEnd = function (winningTeamId) {
    if (!match) return;
    console.log(`[mecz] zwycięstwo: ${teamName(winningTeamId)}`);
    match.posted = true;
    postMatch(self.room, winningTeamId);
    match = null;
  };
  this.onGameStop = function () {
    if (match && !match.posted) console.log("[mecz] anulowany (stop przed zwycięstwem) — nie liczony.");
    match = null;
  };
}
HostConfig.prototype = Object.create(RoomConfig.prototype);

// --- cykl życia z auto-reconnect ---
let stopping = false;

function create() {
  if (stopping) return;
  console.log(`[host] tworzę pokój "${ROOM_NAME}"...`);
  Room.create(
    {
      name: ROOM_NAME,
      password: ROOM_PASSWORD,
      token: HAX_TOKEN,
      noPlayer: true, // host nie gra
      showInRoomList: ROOM_PUBLIC,
      maxPlayerCount: MAX_PLAYERS,
    },
    {
      config: new HostConfig(),
      onOpen: (room) => console.log(`[host] pokój wstał: "${room.name}". Link pojawi się na liście (jeśli publiczny).`),
      onClose: (reason) => {
        console.log(`[host] rozłączony. powód=${reason}. ponawiam za ${RECONNECT_DELAY_MS}ms...`);
        console.log("[host] jeśli powód to zły/wygasły token — pobierz nowy z haxball.com/headlesstoken i zrestartuj.");
        match = null;
        setTimeout(create, RECONNECT_DELAY_MS);
      },
      onError: (err) => console.error(`[host] błąd: ${err}`),
    }
  );
}

if (require.main === module) create();
module.exports = { create };
