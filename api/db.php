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

    // -------------------------------------------------------------- statystyki
    //
    // Warstwa name-based (mecze z pokoju HaxBall). Most do turnieju: nick gracza
    // == name_snapshot uczestnika turnieju, z uwzględnieniem aliasów (scalanie nicków).

    /** @return array<string,string> mapa alias => canonical (jednopoziomowa, DB trzyma płasko) */
    public static function aliasMap(): array
    {
        $map = [];
        foreach (DB::pdo()->query('SELECT alias, canonical FROM aliases')->fetchAll() as $r) {
            $map[$r['alias']] = $r['canonical'];
        }
        return $map;
    }

    /** Podąża łańcuchem aliasów do aktualnego (canonical) nicku. */
    private static function resolve(string $name, array $amap): string
    {
        $seen = [];
        while (isset($amap[$name]) && !isset($seen[$name])) {
            $seen[$name] = true;
            $name = $amap[$name];
        }
        return $name;
    }

    public static function listAliases(): array
    {
        $rows = DB::pdo()->query('SELECT alias, canonical FROM aliases ORDER BY alias')->fetchAll();
        return array_map(static fn(array $r): array => [
            'alias'     => $r['alias'],
            'canonical' => $r['canonical'],
        ], $rows);
    }

    /** Ustawia alias => canonical (spłaszcza łańcuch, upsert). */
    public static function setAlias(string $alias, string $canonical): void
    {
        $canonical = self::resolve($canonical, self::aliasMap());
        $pdo = DB::pdo();
        $pdo->prepare('DELETE FROM aliases WHERE alias = ?')->execute([$alias]);
        $pdo->prepare('INSERT INTO aliases (alias, canonical) VALUES (?, ?)')->execute([$alias, $canonical]);
    }

    public static function deleteAlias(string $alias): void
    {
        DB::pdo()->prepare('DELETE FROM aliases WHERE alias = ?')->execute([$alias]);
    }

    public static function deleteStatMatch(int $id): void
    {
        // CASCADE usuwa stat_match_players i stat_goals
        DB::pdo()->prepare('DELETE FROM stat_matches WHERE id = ?')->execute([$id]);
    }

    /**
     * Zapisuje zakończony mecz z pokoju HaxBall + próbuje auto-linku do aktywnego turnieju.
     * @param array $p ['room','started_at','ended_at','duration_sec','red_score','blue_score',
     *                  'winner','red'=>[nick...],'blue'=>[nick...],'goals'=>[{time,team,scorer,assist,own_goal}]]
     * @return array{id:int, linked:?int}  linked = id meczu turnieju do którego wpisano wynik (albo null)
     */
    public static function ingestStatMatch(array $p): array
    {
        $pdo = DB::pdo();
        $pdo->beginTransaction();
        try {
            $st = $pdo->prepare(
                'INSERT INTO stat_matches
                   (room, started_at, ended_at, duration_sec, red_score, blue_score, winner, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
            );
            $st->execute([
                (string) $p['room'],
                (float) $p['started_at'],
                (float) $p['ended_at'],
                (float) $p['duration_sec'],
                (int) $p['red_score'],
                (int) $p['blue_score'],
                (string) $p['winner'],
                self::now(),
            ]);
            $sid = (int) $pdo->lastInsertId();

            $mp = $pdo->prepare('INSERT INTO stat_match_players (match_id, name, team) VALUES (?, ?, ?)');
            foreach ($p['red'] as $name) {
                $mp->execute([$sid, (string) $name, 'red']);
            }
            foreach ($p['blue'] as $name) {
                $mp->execute([$sid, (string) $name, 'blue']);
            }

            $gi = $pdo->prepare(
                'INSERT INTO stat_goals (match_id, time, team, scorer, assist, own_goal) VALUES (?, ?, ?, ?, ?, ?)'
            );
            foreach (($p['goals'] ?? []) as $g) {
                $gi->execute([
                    $sid,
                    (float) ($g['time'] ?? 0),
                    (string) ($g['team'] ?? ''),
                    isset($g['scorer']) && $g['scorer'] !== '' ? (string) $g['scorer'] : null,
                    isset($g['assist']) && $g['assist'] !== '' ? (string) $g['assist'] : null,
                    !empty($g['own_goal']) ? 1 : 0,
                ]);
            }

            $linked = self::autoLinkActiveTournament(
                array_map('strval', $p['red']),
                array_map('strval', $p['blue']),
                (int) $p['red_score'],
                (int) $p['blue_score']
            );
            if ($linked !== null) {
                $pdo->prepare('UPDATE stat_matches SET tournament_match_id = ? WHERE id = ?')
                    ->execute([$linked, $sid]);
            }

            $pdo->commit();
            return ['id' => $sid, 'linked' => $linked];
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }

    /**
     * Znajduje mecz aktywnego turnieju o tych samych składach (po nickach, aliasach, bez
     * względu na kolejność / stronę), którego JESZCZE nie obsłużył żaden prawdziwy mecz.
     * Gdy znajdzie — wpisuje wynik (prawdziwy wynik nadpisuje ręczny placeholder).
     * @return ?int id meczu turnieju (matches.id) albo null gdy brak dopasowania
     */
    private static function autoLinkActiveTournament(array $red, array $blue, int $redScore, int $blueScore): ?int
    {
        $pdo = DB::pdo();
        $amap = self::aliasMap();
        $rset = self::nameSet($red, $amap);
        $bset = self::nameSet($blue, $amap);

        $rows = $pdo->query(
            "SELECT m.id, m.tournament_id, m.a1_id, m.a2_id, m.b1_id, m.b2_id
             FROM matches m JOIN tournaments t ON t.id = m.tournament_id
             WHERE t.status = 'active'
             ORDER BY m.tournament_id, m.match_no"
        )->fetchAll();
        if (!$rows) {
            return null;
        }

        // migawki nazw uczestników aktywnych turniejów: [tournament_id][player_id] => nick
        $names = [];
        $tp = $pdo->query(
            "SELECT tp.tournament_id, tp.player_id, tp.name_snapshot
             FROM tournament_players tp JOIN tournaments t ON t.id = tp.tournament_id
             WHERE t.status = 'active'"
        )->fetchAll();
        foreach ($tp as $r) {
            $names[(int) $r['tournament_id']][(int) $r['player_id']] = $r['name_snapshot'];
        }

        // które mecze turniejów już mają przypisany prawdziwy mecz (nie nadpisujemy)
        $taken = [];
        foreach ($pdo->query('SELECT tournament_match_id FROM stat_matches WHERE tournament_match_id IS NOT NULL')
                     ->fetchAll() as $r) {
            $taken[(int) $r['tournament_match_id']] = true;
        }

        foreach ($rows as $row) {
            $mid = (int) $row['id'];
            if (isset($taken[$mid])) {
                continue;
            }
            $tid = (int) $row['tournament_id'];
            $nm = $names[$tid] ?? [];
            $teamA = self::nameSet([
                $nm[(int) $row['a1_id']] ?? '', $nm[(int) $row['a2_id']] ?? '',
            ], $amap);
            $teamB = self::nameSet([
                $nm[(int) $row['b1_id']] ?? '', $nm[(int) $row['b2_id']] ?? '',
            ], $amap);

            if ($rset === $teamA && $bset === $teamB) {
                self::setScore($mid, $redScore, $blueScore);
                return $mid;
            }
            if ($rset === $teamB && $bset === $teamA) {
                self::setScore($mid, $blueScore, $redScore);
                return $mid;
            }
        }
        return null;
    }

    /** Zbiór nicków (posortowany, aliasy zresolvowane) do porównania składów. */
    private static function nameSet(array $names, array $amap): array
    {
        $out = [];
        foreach ($names as $n) {
            $n = self::resolve((string) $n, $amap);
            if ($n !== '') {
                $out[$n] = true;
            }
        }
        $out = array_keys($out);
        sort($out);
        return $out;
    }

    /**
     * Surowe dane dla klienta (liczy ranking/Elo/H2H po swojej stronie, jak reszta appki).
     * Łączy dwa źródła w jeden kształt name-based:
     *   - mecze na żywo (stat_matches) — pełne, z golami,
     *   - rzut meczów turniejowych z wynikiem, których NIE obsłużył mecz na żywo (dedup).
     * @return array{matches:array, aliases:array}
     */
    public static function statData(): array
    {
        $pdo = DB::pdo();

        // --- mecze na żywo ---
        $players = [];
        foreach ($pdo->query('SELECT match_id, name, team FROM stat_match_players')->fetchAll() as $r) {
            $players[(int) $r['match_id']][$r['team']][] = $r['name'];
        }
        $goals = [];
        foreach ($pdo->query('SELECT match_id, time, team, scorer, assist, own_goal FROM stat_goals ORDER BY time')
                     ->fetchAll() as $r) {
            $goals[(int) $r['match_id']][] = [
                'time'     => (float) $r['time'],
                'team'     => $r['team'],
                'scorer'   => $r['scorer'],
                'assist'   => $r['assist'],
                'own_goal' => (int) $r['own_goal'] === 1,
            ];
        }

        $matches = [];
        $linked = [];
        foreach ($pdo->query('SELECT * FROM stat_matches ORDER BY started_at')->fetchAll() as $r) {
            $id = (int) $r['id'];
            if ($r['tournament_match_id'] !== null) {
                $linked[(int) $r['tournament_match_id']] = true;
            }
            $matches[] = [
                'id'         => 'L' . $id,
                'source'     => 'live',
                'started_at' => (float) $r['started_at'],
                'red_score'  => (int) $r['red_score'],
                'blue_score' => (int) $r['blue_score'],
                'winner'     => $r['winner'],
                'red'        => $players[$id]['red'] ?? [],
                'blue'       => $players[$id]['blue'] ?? [],
                'goals'      => $goals[$id] ?? [],
            ];
        }

        // --- rzut meczów turniejowych (tylko z wynikiem i bez meczu na żywo) ---
        $trows = $pdo->query(
            'SELECT m.id, m.tournament_id, m.a1_id, m.a2_id, m.b1_id, m.b2_id,
                    m.score_a, m.score_b, t.created_at
             FROM matches m JOIN tournaments t ON t.id = m.tournament_id
             WHERE m.score_a IS NOT NULL AND m.score_b IS NOT NULL'
        )->fetchAll();
        if ($trows) {
            $tnames = [];
            foreach ($pdo->query('SELECT tournament_id, player_id, name_snapshot FROM tournament_players')->fetchAll()
                     as $r) {
                $tnames[(int) $r['tournament_id']][(int) $r['player_id']] = $r['name_snapshot'];
            }
            foreach ($trows as $r) {
                $mid = (int) $r['id'];
                if (isset($linked[$mid])) {
                    continue; // ten mecz jest już reprezentowany przez mecz na żywo
                }
                $tid = (int) $r['tournament_id'];
                $nm = $tnames[$tid] ?? [];
                $a = (int) $r['score_a'];
                $b = (int) $r['score_b'];
                $matches[] = [
                    'id'         => 'T' . $mid,
                    'source'     => 'tournament',
                    'started_at' => (float) strtotime((string) $r['created_at']),
                    'red_score'  => $a,
                    'blue_score' => $b,
                    'winner'     => $a > $b ? 'red' : 'blue',
                    'red'        => array_values(array_filter([
                        $nm[(int) $r['a1_id']] ?? null, $nm[(int) $r['a2_id']] ?? null,
                    ])),
                    'blue'       => array_values(array_filter([
                        $nm[(int) $r['b1_id']] ?? null, $nm[(int) $r['b2_id']] ?? null,
                    ])),
                    'goals'      => [],
                ];
            }
        }

        return ['matches' => $matches, 'aliases' => self::listAliases()];
    }
}
