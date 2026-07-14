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

-- Mecze 2v2 + wyniki. Pauzujący = uczestnicy turnieju minus 4 gracze meczu (wyliczane).
CREATE TABLE matches (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  tournament_id INT NOT NULL,
  match_no      INT NOT NULL,      -- kolejność w harmonogramie
  a1_id         INT NOT NULL,      -- drużyna A, gracz 1
  a2_id         INT NOT NULL,      -- drużyna A, gracz 2
  b1_id         INT NOT NULL,      -- drużyna B, gracz 1
  b2_id         INT NOT NULL,      -- drużyna B, gracz 2
  score_a       INT NULL,          -- bramki drużyny A (NULL = jeszcze nierozegrany)
  score_b       INT NULL,          -- bramki drużyny B
  CONSTRAINT fk_m_t FOREIGN KEY (tournament_id) REFERENCES tournaments(id) ON DELETE CASCADE,
  INDEX idx_m_t (tournament_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
