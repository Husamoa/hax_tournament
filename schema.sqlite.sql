-- Pitole — schemat SQLite do developmentu lokalnego (bez serwera MySQL)
-- Utworzenie bazy:  sqlite3 api/pitole.sqlite < schema.sqlite.sql
-- Produkcja (OVH) używa schema.sql (MySQL).

PRAGMA foreign_keys = ON;

CREATE TABLE players (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL UNIQUE,
  is_guest   INTEGER NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT    NOT NULL
);

CREATE TABLE tournaments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT,
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','finished')),
  auto_fill        INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL,
  finished_at      TEXT,
  winner_player_id INTEGER REFERENCES players(id)
);

CREATE TABLE tournament_players (
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id     INTEGER NOT NULL REFERENCES players(id),
  name_snapshot TEXT    NOT NULL,
  PRIMARY KEY (tournament_id, player_id)
);

CREATE TABLE matches (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  match_no      INTEGER NOT NULL,
  a1_id         INTEGER NOT NULL,
  a2_id         INTEGER NOT NULL,
  a3_id         INTEGER,           -- drużyna A, gracz 3 (NULL = tryb 2v2)
  b1_id         INTEGER NOT NULL,
  b2_id         INTEGER NOT NULL,
  b3_id         INTEGER,           -- drużyna B, gracz 3 (NULL = tryb 2v2)
  score_a       INTEGER,
  score_b       INTEGER
);

CREATE INDEX idx_m_t ON matches(tournament_id);

-- ------------------------------------------------------------------ STATYSTYKI
-- (opis: patrz schema.sql). Warstwa name-based; most do turnieju = nick + aliasy.

CREATE TABLE stat_matches (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  room                TEXT    NOT NULL,
  started_at          REAL    NOT NULL,
  ended_at            REAL    NOT NULL,
  duration_sec        REAL    NOT NULL,
  red_score           INTEGER NOT NULL,
  blue_score          INTEGER NOT NULL,
  winner              TEXT    NOT NULL,
  is_training         INTEGER NOT NULL DEFAULT 0,  -- 1 = mecz treningowy (nie liczony do statystyk)
  tournament_match_id INTEGER REFERENCES matches(id) ON DELETE SET NULL,
  created_at          TEXT    NOT NULL
);
CREATE INDEX idx_sm_tm ON stat_matches(tournament_match_id);

CREATE TABLE stat_match_players (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES stat_matches(id) ON DELETE CASCADE,
  name     TEXT    NOT NULL,
  team     TEXT    NOT NULL
);
CREATE INDEX idx_smp_m ON stat_match_players(match_id);
CREATE INDEX idx_smp_name ON stat_match_players(name);

CREATE TABLE stat_goals (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  match_id INTEGER NOT NULL REFERENCES stat_matches(id) ON DELETE CASCADE,
  time     REAL    NOT NULL,
  team     TEXT    NOT NULL,
  scorer   TEXT,
  assist   TEXT,
  own_goal INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_sg_m ON stat_goals(match_id);

CREATE TABLE aliases (
  alias     TEXT NOT NULL PRIMARY KEY,
  canonical TEXT NOT NULL
);
