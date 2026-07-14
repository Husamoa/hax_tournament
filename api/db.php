<?php
declare(strict_types=1);

/**
 * JEDYNA warstwa dostępu do bazy.
 * Cały SQL aplikacji żyje tutaj (klasa Repo). Podmiana bazy (MySQL <-> SQLite)
 * to zmiana DSN w api/config.php — reszta kodu się nie zmienia.
 */

final class DB
{
    private static ?PDO $pdo = null;

    public static function pdo(): PDO
    {
        if (self::$pdo === null) {
            $cfg = require __DIR__ . '/config.php';
            self::$pdo = new PDO(
                $cfg['db_dsn'],
                $cfg['db_user'] ?? null,
                $cfg['db_pass'] ?? null,
                [
                    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_EMULATE_PREPARES   => false,
                ]
            );
            if (str_starts_with($cfg['db_dsn'], 'sqlite:')) {
                self::$pdo->exec('PRAGMA foreign_keys = ON');
            }
        }
        return self::$pdo;
    }
}

final class Repo
{
    private static function now(): string
    {
        return date('Y-m-d H:i:s');
    }

    // ----------------------------------------------------------------- players

    /** @return array<int,array> aktywni gracze rostera, alfabetycznie */
    public static function listPlayers(): array
    {
        $rows = DB::pdo()
            ->query('SELECT id, name, is_guest, archived FROM players WHERE archived = 0 ORDER BY name')
            ->fetchAll();
        return array_map([self::class, 'castPlayer'], $rows);
    }

    public static function addPlayer(string $name, int $isGuest): array
    {
        $pdo = DB::pdo();
        $st = $pdo->prepare('INSERT INTO players (name, is_guest, archived, created_at) VALUES (?, ?, 0, ?)');
        $st->execute([$name, $isGuest, self::now()]);
        return [
            'id'       => (int) $pdo->lastInsertId(),
            'name'     => $name,
            'is_guest' => $isGuest,
            'archived' => 0,
        ];
    }

    public static function archivePlayer(int $id): void
    {
        DB::pdo()->prepare('UPDATE players SET archived = 1 WHERE id = ?')->execute([$id]);
    }

    private static function castPlayer(array $r): array
    {
        return [
            'id'       => (int) $r['id'],
            'name'     => $r['name'],
            'is_guest' => (int) $r['is_guest'],
            'archived' => (int) $r['archived'],
        ];
    }

    // ------------------------------------------------------------- tournaments

    /** Lista turniejów (do ekranu Historia + wykrycia aktywnego). */
    public static function listTournaments(): array
    {
        $sql = 'SELECT t.id, t.name, t.status, t.created_at, t.finished_at,
                       t.winner_player_id,
                       (SELECT name FROM players WHERE id = t.winner_player_id) AS winner_name,
                       (SELECT COUNT(*) FROM tournament_players tp WHERE tp.tournament_id = t.id) AS player_count
                FROM tournaments t
                ORDER BY t.created_at DESC, t.id DESC';
        $rows = DB::pdo()->query($sql)->fetchAll();
        return array_map(static function (array $r): array {
            return [
                'id'               => (int) $r['id'],
                'name'             => $r['name'],
                'status'           => $r['status'],
                'created_at'       => $r['created_at'],
                'finished_at'      => $r['finished_at'],
                'winner_player_id' => $r['winner_player_id'] !== null ? (int) $r['winner_player_id'] : null,
                'winner_name'      => $r['winner_name'],
                'player_count'     => (int) $r['player_count'],
            ];
        }, $rows);
    }

    /**
     * Tworzy turniej w jednej transakcji: nagłówek + uczestnicy (z migawką nazw) + mecze.
     * @param array $playerIds  identyfikatory graczy z rostera
     * @param array $matches    [{teamA:[id,id], teamB:[id,id]}, ...] (kolejność = match_no)
     */
    public static function createTournament(?string $name, array $playerIds, array $matches, string $status): int
    {
        $pdo = DB::pdo();
        $pdo->beginTransaction();
        try {
            $st = $pdo->prepare('INSERT INTO tournaments (name, status, created_at) VALUES (?, ?, ?)');
            $st->execute([$name, $status, self::now()]);
            $tid = (int) $pdo->lastInsertId();

            // uczestnicy + migawka nazw
            $nameById = self::namesByIds($playerIds);
            $tp = $pdo->prepare('INSERT INTO tournament_players (tournament_id, player_id, name_snapshot) VALUES (?, ?, ?)');
            foreach ($playerIds as $pid) {
                $pid = (int) $pid;
                $tp->execute([$tid, $pid, $nameById[$pid] ?? ('#' . $pid)]);
            }

            // mecze
            $mi = $pdo->prepare(
                'INSERT INTO matches (tournament_id, match_no, a1_id, a2_id, b1_id, b2_id) VALUES (?, ?, ?, ?, ?, ?)'
            );
            $no = 1;
            foreach ($matches as $m) {
                $a = $m['teamA'];
                $b = $m['teamB'];
                $mi->execute([$tid, $no++, (int) $a[0], (int) $a[1], (int) $b[0], (int) $b[1]]);
            }

            $pdo->commit();
            return $tid;
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }

    /** Pełne dane turnieju: nagłówek + uczestnicy + mecze (z wynikami). null gdy brak. */
    public static function getTournament(int $id): ?array
    {
        $pdo = DB::pdo();
        $st = $pdo->prepare('SELECT * FROM tournaments WHERE id = ?');
        $st->execute([$id]);
        $t = $st->fetch();
        if (!$t) {
            return null;
        }

        $ps = $pdo->prepare(
            'SELECT player_id, name_snapshot FROM tournament_players WHERE tournament_id = ? ORDER BY name_snapshot'
        );
        $ps->execute([$id]);
        $players = array_map(static function (array $r): array {
            return ['id' => (int) $r['player_id'], 'name' => $r['name_snapshot']];
        }, $ps->fetchAll());

        $ms = $pdo->prepare('SELECT * FROM matches WHERE tournament_id = ? ORDER BY match_no');
        $ms->execute([$id]);
        $matches = array_map(static function (array $r): array {
            return [
                'id'       => (int) $r['id'],
                'match_no' => (int) $r['match_no'],
                'teamA'    => [(int) $r['a1_id'], (int) $r['a2_id']],
                'teamB'    => [(int) $r['b1_id'], (int) $r['b2_id']],
                'scoreA'   => $r['score_a'] !== null ? (int) $r['score_a'] : null,
                'scoreB'   => $r['score_b'] !== null ? (int) $r['score_b'] : null,
            ];
        }, $ms->fetchAll());

        return [
            'id'               => (int) $t['id'],
            'name'             => $t['name'],
            'status'           => $t['status'],
            'created_at'       => $t['created_at'],
            'finished_at'      => $t['finished_at'],
            'winner_player_id' => $t['winner_player_id'] !== null ? (int) $t['winner_player_id'] : null,
            'players'          => $players,
            'matches'          => $matches,
        ];
    }

    /** Zapisuje wynik meczu. Przekazanie null,null czyści wynik. */
    public static function setScore(int $matchId, ?int $a, ?int $b): void
    {
        DB::pdo()
            ->prepare('UPDATE matches SET score_a = ?, score_b = ? WHERE id = ?')
            ->execute([$a, $b, $matchId]);
    }

    public static function finishTournament(int $id, ?int $winnerId): void
    {
        DB::pdo()
            ->prepare("UPDATE tournaments SET status = 'finished', finished_at = ?, winner_player_id = ? WHERE id = ?")
            ->execute([self::now(), $winnerId, $id]);
    }

    public static function deleteTournament(int $id): void
    {
        // ON DELETE CASCADE usuwa powiązane tournament_players i matches
        DB::pdo()->prepare('DELETE FROM tournaments WHERE id = ?')->execute([$id]);
    }

    /** @return array<int,string> mapa id => name dla podanych identyfikatorów */
    private static function namesByIds(array $ids): array
    {
        $ids = array_values(array_unique(array_map('intval', $ids)));
        if (!$ids) {
            return [];
        }
        $ph = implode(',', array_fill(0, count($ids), '?'));
        $st = DB::pdo()->prepare("SELECT id, name FROM players WHERE id IN ($ph)");
        $st->execute($ids);
        $map = [];
        foreach ($st->fetchAll() as $r) {
            $map[(int) $r['id']] = $r['name'];
        }
        return $map;
    }
}
