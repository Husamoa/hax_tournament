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
  b1_id         INTEGER NOT NULL,
  b2_id         INTEGER NOT NULL,
  score_a       INTEGER,
  score_b       INTEGER
);

CREATE INDEX idx_m_t ON matches(tournament_id);
