-- Pitole — schemat bazy MySQL (produkcja / OVH)
-- Import przez phpMyAdmin (OVH Manager) albo:  mysql -u USER -p DBNAME < schema.sql
-- Wariant lokalny (SQLite) do developmentu: patrz schema.sqlite.sql

SET NAMES utf8mb4;

-- Globalny roster ekipy (wielokrotnego użytku między turniejami)
CREATE TABLE players (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(64) NOT NULL UNIQUE,
  is_guest   TINYINT     NOT NULL DEFAULT 0,   -- 1 = gość spoza stałej ekipy
  archived   TINYINT     NOT NULL DEFAULT 0,   -- 1 = ukryty na liście wyboru
  created_at DATETIME    NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE tournaments (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  name             VARCHAR(128) NULL,                              -- domyślnie generowana z daty
  status           ENUM('draft','active','finished') NOT NULL DEFAULT 'active',
  auto_fill        TINYINT NOT NULL DEFAULT 1,                     -- 1 = wyniki z pokoju HaxBall wpadają automatycznie (wajcha)
  created_at       DATETIME NOT NULL,
  finished_at      DATETIME NULL,
  winner_player_id INT NULL,
  CONSTRAINT fk_winner FOREIGN KEY (winner_player_id) REFERENCES players(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Uczestnicy turnieju (migawka: name_snapshot chroni tabelę przed późniejszą zmianą nazwy w rosterze)
CREATE TABLE tournament_players (
  tournament_id INT NOT NULL,
  player_id     INT NOT NULL,
  name_snapshot VARCHAR(64) NOT NULL,
  PRIMARY KEY (tournament_id, player_id),
  CONSTRAINT fk_tp_t FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  CONSTRAINT fk_tp_p FOREIGN KEY (player_id)     REFERENCES players(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Mecze 2v2/3v3 + wyniki. Pauzujący = uczestnicy turnieju minus grający (wyliczane).
CREATE TABLE matches (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  tournament_id INT NOT NULL,
  match_no      INT NOT NULL,      -- kolejność w harmonogramie
  a1_id         INT NOT NULL,      -- drużyna A, gracz 1
  a2_id         INT NOT NULL,      -- drużyna A, gracz 2
  a3_id         INT NULL,          -- drużyna A, gracz 3 (NULL = tryb 2v2)
  b1_id         INT NOT NULL,      -- drużyna B, gracz 1
  b2_id         INT NOT NULL,      -- drużyna B, gracz 2
  b3_id         INT NULL,          -- drużyna B, gracz 3 (NULL = tryb 2v2)
  score_a       INT NULL,          -- bramki drużyny A (NULL = jeszcze nierozegrany)
  score_b       INT NULL,          -- bramki drużyny B
  CONSTRAINT fk_m_t FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  INDEX idx_m_t (tournament_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ------------------------------------------------------------------ STATYSTYKI
-- Moduł statystyk zbiera mecze z pokoju HaxBall (przez tampera, endpoint ingest).
-- Gracze identyfikowani po NAZWIE (haxball nie ma stałego id). To osobna warstwa od
-- rostera turniejowego (id-owego); most między nimi to nick == name_snapshot + aliasy.

-- Zakończony (zwycięski) mecz z pokoju HaxBall.
CREATE TABLE stat_matches (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  room                VARCHAR(64) NOT NULL,          -- id pokoju albo "manual"
  started_at          DOUBLE      NOT NULL,          -- unix (float, sekundy)
  ended_at            DOUBLE      NOT NULL,
  duration_sec        DOUBLE      NOT NULL,
  red_score           INT         NOT NULL,
  blue_score          INT         NOT NULL,
  winner              VARCHAR(8)  NOT NULL,           -- 'red' | 'blue'
  is_training         TINYINT     NOT NULL DEFAULT 0, -- 1 = mecz treningowy (nie liczony do statystyk)
  tournament_match_id INT NULL,                       -- auto-link do meczu turnieju (dedup)
  created_at          DATETIME    NOT NULL,
  CONSTRAINT fk_sm_tm FOREIGN KEY (tournament_match_id) REFERENCES matches(id) ON DELETE SET NULL,
  INDEX idx_sm_tm (tournament_match_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Skład drużyny (migawka z onGameStart). team = 'red' | 'blue'.
CREATE TABLE stat_match_players (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  match_id INT NOT NULL,
  name     VARCHAR(64) NOT NULL,
  team     VARCHAR(8)  NOT NULL,
  CONSTRAINT fk_smp_m FOREIGN KEY (match_id) REFERENCES stat_matches(id) ON DELETE CASCADE,
  INDEX idx_smp_m (match_id),
  INDEX idx_smp_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Gole (strzelec/asysta mogą być NULL — z DOM przeglądarki nie da się ich odczytać).
CREATE TABLE stat_goals (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  match_id INT NOT NULL,
  time     DOUBLE      NOT NULL,
  team     VARCHAR(8)  NOT NULL,
  scorer   VARCHAR(64) NULL,
  assist   VARCHAR(64) NULL,
  own_goal TINYINT     NOT NULL DEFAULT 0,
  CONSTRAINT fk_sg_m FOREIGN KEY (match_id) REFERENCES stat_matches(id) ON DELETE CASCADE,
  INDEX idx_sg_m (match_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Scalanie nicków: alias (stary/inny nick) -> canonical (aktualny). Odwracalne.
CREATE TABLE aliases (
  alias     VARCHAR(64) NOT NULL PRIMARY KEY,
  canonical VARCHAR(64) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
