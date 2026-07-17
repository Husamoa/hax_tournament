<?php
declare(strict_types=1);

/**
 * Pitole — cienki router JSON API.
 *
 * Routing przez query-string (bez potrzeby .htaccess / rewrite na OVH):
 *   GET    api/index.php?r=session
 *   POST   api/index.php?r=login            {password}
 *   POST   api/index.php?r=logout
 *   GET    api/index.php?r=players
 *   POST   api/index.php?r=players          {name, is_guest}
 *   PATCH  api/index.php?r=players&id=ID     (archiwizacja)
 *   GET    api/index.php?r=tournaments               (lista)
 *   GET    api/index.php?r=tournaments&id=ID          (szczegóły)
 *   POST   api/index.php?r=tournaments      {name?, playerIds:[], matches:[], status?}
 *   PATCH  api/index.php?r=tournaments&id=ID {auto_fill}   (wajcha auto-uzupełniania z pokoju)
 *   DELETE api/index.php?r=tournaments&id=ID
 *   POST   api/index.php?r=finish&id=ID     {winner_player_id}
 *   PATCH  api/index.php?r=matches&id=ID    {score_a, score_b}   (null,null = wyczyść)
 *   POST   api/index.php?r=ingest          {room,red[],blue[],red_score,blue_score,winner,goals[]}  (BEZ auth — tamper)
 *   GET    api/index.php?r=stats            (surowe mecze + aliasy do liczenia statystyk po stronie klienta)
 *   GET    api/index.php?r=aliases
 *   POST   api/index.php?r=aliases         {alias, canonical}   (scalanie nicków)
 *   DELETE api/index.php?r=aliases&alias=NICK
 *   POST   api/index.php?r=stat_matches     {red[],blue[],red_score,blue_score,started_at?}  (dodaj ręczny mecz)
 *   PUT    api/index.php?r=stat_matches&id=ID {red[],blue[],red_score,blue_score,started_at?}  (edytuj ręczny mecz)
 *   PATCH  api/index.php?r=stat_matches&id=ID  {is_training}  (oznacz treningowy/oficjalny)
 *   DELETE api/index.php?r=stat_matches&id=ID   (usuń ręczny mecz)
 *
 * Wszystko poza session/login/ingest wymaga zalogowania (wspólne hasło ekipy -> sesja).
 */

require __DIR__ . '/db.php';
$cfg = require __DIR__ . '/config.php';

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

function body_json(): array
{
    $raw = file_get_contents('php://input');
    $d = json_decode($raw ?: '', true);
    return is_array($d) ? $d : [];
}

function out($data, int $code = 200): never
{
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

function err(string $msg, int $code = 400): never
{
    out(['error' => $msg], $code);
}

function is_authed(): bool
{
    return !empty($_SESSION['authed']);
}

function require_auth(): void
{
    if (!is_authed()) {
        err('Wymagane logowanie.', 401);
    }
}

/**
 * Waliduje i normalizuje body ręcznego meczu (POST/PUT ?r=stat_matches). Przy błędzie kończy
 * przez err(). Zwraca payload gotowy dla Repo: [started_at, red_score, blue_score, winner, red[], blue[]].
 */
function manual_match_payload(array $b): array
{
    $clean = static function ($list): array {
        $out = [];
        foreach (is_array($list) ? $list : [] as $n) {
            $n = trim((string) $n);
            if ($n !== '') {
                $out[] = $n;
            }
        }
        return $out;
    };
    $red = $clean($b['red'] ?? []);
    $blue = $clean($b['blue'] ?? []);
    if (count($red) === 0 || count($blue) === 0) {
        err('Podaj skład obu drużyn.');
    }
    if (count($red) > 3 || count($blue) > 3) {
        err('Maksymalnie 3 graczy w drużynie.');
    }
    $all = array_merge($red, $blue);
    if (count(array_unique(array_map('mb_strtolower', $all))) !== count($all)) {
        err('Gracze w meczu muszą być różni.');
    }
    $a = $b['red_score'] ?? null;
    $bb = $b['blue_score'] ?? null;
    if (!is_numeric($a) || !is_numeric($bb) || (int) $a < 0 || (int) $bb < 0
        || (float) $a != (int) $a || (float) $bb != (int) $bb) {
        err('Wynik musi być liczbą całkowitą ≥ 0.');
    }
    $a = (int) $a;
    $bb = (int) $bb;
    if ($a === $bb) {
        err('Remis niedozwolony — popraw wynik.');
    }
    $now = time();
    $started = is_numeric($b['started_at'] ?? null) ? (float) $b['started_at'] : $now;
    if ($started > $now + 86400 || $started < 946684800) {
        $started = $now; // spoza sensownego zakresu -> teraz
    }
    return [
        'started_at' => $started,
        'red_score'  => $a,
        'blue_score' => $bb,
        'winner'     => $a > $bb ? 'red' : 'blue',
        'red'        => $red,
        'blue'       => $blue,
    ];
}

// --- sesja (długa, bezpieczne cookie; secure tylko pod HTTPS) ---
// Problem na współdzielonym hostingu (OVH): mimo długiego cookie PHP kasuje pliki sesji po
// `session.gc_maxlifetime` (domyślnie ~24 min), a host sprząta wspólny katalog sesji cronem —
// przez co użytkownik jest wylogowywany po chwili. Dlatego: (1) trzymamy sesje we WŁASNYM
// katalogu (host go nie rusza, GC innych kont też nie), (2) wydłużamy gc_maxlifetime,
// (3) cookie jest długie i ślizgowe (każda wizyta przedłuża — z użyciem sesja nie wygasa).
$secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');

$sessionTtl = 60 * 60 * 24 * 365; // 1 rok
$cookieParams = [
    'path'     => '/',
    'secure'   => $secure,
    'httponly' => true,
    'samesite' => 'Lax',
];

ini_set('session.gc_maxlifetime', (string) $sessionTtl);

// Własny katalog na pliki sesji (obok bazy w api/). Gdyby był niezapisywalny — cichy fallback
// do domyślnego save_path (nie gorzej niż dotychczas).
$sessDir = __DIR__ . '/sessions';
if (!is_dir($sessDir)) {
    @mkdir($sessDir, 0700, true);
}
if (is_dir($sessDir) && is_writable($sessDir)) {
    // Ochrona: pliki sesji nigdy nie mogą być serwowane po HTTP (katalog jest pod web rootem).
    $ht = $sessDir . '/.htaccess';
    if (!is_file($ht)) {
        @file_put_contents(
            $ht,
            "<IfModule mod_authz_core.c>\n  Require all denied\n</IfModule>\n"
            . "<IfModule !mod_authz_core.c>\n  Order deny,allow\n  Deny from all\n</IfModule>\n"
        );
    }
    session_save_path($sessDir);
}

session_set_cookie_params(['lifetime' => $sessionTtl] + $cookieParams);
session_name('pitole_sess');
session_start();

// Ślizgowe przedłużanie: przy zalogowanej sesji odśwież cookie (kolejny rok) i mtime pliku
// sesji, żeby aktywnie używana sesja praktycznie nigdy nie wygasała.
if (is_authed()) {
    $_SESSION['seen'] = time();
    setcookie(session_name(), session_id(), ['expires' => time() + $sessionTtl] + $cookieParams);
}

$r = (string) ($_GET['r'] ?? '');
$method = $_SERVER['REQUEST_METHOD'];
$id = isset($_GET['id']) ? (int) $_GET['id'] : 0;

try {
    switch ($r) {
        case 'session':
            out(['authed' => is_authed()]);

            // no break (out() kończy skrypt)
        case 'login':
            if ($method !== 'POST') {
                err('Metoda niedozwolona.', 405);
            }
            $pass = (string) (body_json()['password'] ?? '');
            if ($pass !== '' && password_verify($pass, (string) $cfg['password_hash'])) {
                session_regenerate_id(true);
                $_SESSION['authed'] = true;
                out(['authed' => true]);
            }
            err('Błędne hasło.', 401);

        case 'logout':
            $_SESSION = [];
            session_destroy();
            out(['authed' => false]);

        case 'players':
            require_auth();
            if ($method === 'GET') {
                out(Repo::listPlayers());
            }
            if ($method === 'POST') {
                $b = body_json();
                $name = trim((string) ($b['name'] ?? ''));
                if ($name === '') {
                    err('Podaj nazwę gracza.');
                }
                if (mb_strlen($name) > 64) {
                    err('Nazwa za długa (max 64 znaki).');
                }
                try {
                    out(Repo::addPlayer($name, !empty($b['is_guest']) ? 1 : 0), 201);
                } catch (PDOException $e) {
                    err('Gracz o tej nazwie już istnieje.', 409);
                }
            }
            if ($method === 'PATCH') {
                if ($id <= 0) {
                    err('Brak id gracza.');
                }
                Repo::archivePlayer($id);
                out(['ok' => true]);
            }
            err('Metoda niedozwolona.', 405);

        case 'tournaments':
            require_auth();
            if ($method === 'GET') {
                if ($id > 0) {
                    $t = Repo::getTournament($id);
                    if (!$t) {
                        err('Nie znaleziono turnieju.', 404);
                    }
                    out($t);
                }
                out(Repo::listTournaments());
            }
            if ($method === 'POST') {
                $b = body_json();
                $playerIds = $b['playerIds'] ?? [];
                $matches = $b['matches'] ?? [];
                if (!is_array($playerIds) || count($playerIds) < 4) {
                    err('Wymagane minimum 4 graczy.');
                }
                if (!is_array($matches) || count($matches) < 1) {
                    err('Brak meczów w harmonogramie.');
                }
                foreach ($matches as $m) {
                    $a = $m['teamA'] ?? null;
                    $tb = $m['teamB'] ?? null;
                    if (!is_array($a) || !is_array($tb)) {
                        err('Niepoprawny format meczu.');
                    }
                    $size = count($a);
                    if (($size !== 2 && $size !== 3) || count($tb) !== $size) {
                        err('Drużyny muszą liczyć po 2 albo 3 graczy.');
                    }
                    $ids = [];
                    foreach (array_merge($a, $tb) as $pid) {
                        if (!is_numeric($pid) || (int) $pid <= 0) {
                            err('Niepoprawny format meczu.');
                        }
                        $ids[] = (int) $pid;
                    }
                    if (count(array_unique($ids)) !== 2 * $size) {
                        err('Gracze w meczu muszą być różni.');
                    }
                }
                $name = isset($b['name']) && trim((string) $b['name']) !== '' ? trim((string) $b['name']) : null;
                $status = ($b['status'] ?? 'active') === 'draft' ? 'draft' : 'active';
                $tid = Repo::createTournament($name, $playerIds, $matches, $status);
                out(Repo::getTournament($tid), 201);
            }
            if ($method === 'PATCH') {
                if ($id <= 0) {
                    err('Brak id turnieju.');
                }
                $b = body_json();
                if (!array_key_exists('auto_fill', $b)) {
                    err('Brak pola auto_fill.');
                }
                Repo::setAutoFill($id, !empty($b['auto_fill']));
                out(['ok' => true, 'auto_fill' => !empty($b['auto_fill']) ? 1 : 0]);
            }
            if ($method === 'DELETE') {
                if ($id <= 0) {
                    err('Brak id turnieju.');
                }
                Repo::deleteTournament($id);
                out(['ok' => true]);
            }
            err('Metoda niedozwolona.', 405);

        case 'finish':
            require_auth();
            if ($method !== 'POST') {
                err('Metoda niedozwolona.', 405);
            }
            if ($id <= 0) {
                err('Brak id turnieju.');
            }
            $winner = body_json()['winner_player_id'] ?? null;
            Repo::finishTournament($id, $winner !== null ? (int) $winner : null);
            out(Repo::getTournament($id));

        case 'reopen':
            require_auth();
            if ($method !== 'POST') {
                err('Metoda niedozwolona.', 405);
            }
            if ($id <= 0) {
                err('Brak id turnieju.');
            }
            if (Repo::tournamentStatus($id) !== 'finished') {
                err('Można wznowić tylko zakończony turniej.');
            }
            if (Repo::hasActiveTournament()) {
                err('Najpierw zakończ aktywny turniej.', 409);
            }
            Repo::reopenTournament($id);
            out(Repo::getTournament($id));

        case 'matches':
            require_auth();
            if ($method !== 'PATCH') {
                err('Metoda niedozwolona.', 405);
            }
            if ($id <= 0) {
                err('Brak id meczu.');
            }
            $b = body_json();
            $a = $b['score_a'] ?? null;
            $bb = $b['score_b'] ?? null;
            if ($a === null && $bb === null) {
                Repo::setScore($id, null, null); // wyczyść wynik
                out(['ok' => true]);
            }
            if (!is_numeric($a) || !is_numeric($bb) || (int) $a < 0 || (int) $bb < 0
                || (float) $a != (int) $a || (float) $bb != (int) $bb) {
                err('Wynik musi być liczbą całkowitą ≥ 0.');
            }
            $a = (int) $a;
            $bb = (int) $bb;
            if ($a === $bb) {
                err('Remis niedozwolony — popraw wynik.');
            }
            Repo::setScore($id, $a, $bb);
            out(['ok' => true]);

        case 'ingest':
            // Endpoint dla tampera — zakończony mecz z pokoju HaxBall. BEZ logowania
            // (userscript działa cross-origin na haxball.com, nie ma sesji PHP).
            if ($method !== 'POST') {
                err('Metoda niedozwolona.', 405);
            }
            $b = body_json();
            $red = $b['red'] ?? [];
            $blue = $b['blue'] ?? [];
            if (!is_array($red) || !is_array($blue) || count($red) === 0 || count($blue) === 0) {
                out(['counted' => false, 'error' => 'Pusty skład.'], 200);
            }
            $winner = ($b['winner'] ?? '') === 'blue' ? 'blue' : 'red';
            $now = time();
            $payload = [
                'room'         => (string) ($b['room'] ?? 'unknown'),
                'started_at'   => is_numeric($b['started_at'] ?? null) ? (float) $b['started_at'] : $now,
                'ended_at'     => is_numeric($b['ended_at'] ?? null) ? (float) $b['ended_at'] : $now,
                'duration_sec' => is_numeric($b['duration_sec'] ?? null) ? (float) $b['duration_sec'] : 0,
                'red_score'    => (int) ($b['red_score'] ?? 0),
                'blue_score'   => (int) ($b['blue_score'] ?? 0),
                'winner'       => $winner,
                'red'          => array_values(array_filter(array_map('strval', $red), 'strlen')),
                'blue'         => array_values(array_filter(array_map('strval', $blue), 'strlen')),
                'goals'        => is_array($b['goals'] ?? null) ? $b['goals'] : [],
            ];
            $res = Repo::ingestStatMatch($payload);
            out(['id' => $res['id'], 'counted' => true, 'linked' => $res['linked']], 201);

        case 'stats':
            require_auth();
            if ($method !== 'GET') {
                err('Metoda niedozwolona.', 405);
            }
            out(Repo::statData());

        case 'stat_matches':
            require_auth();
            if ($method === 'POST') {
                // Ręczne dodanie meczu do statystyk (name-based, jak mecz z pokoju).
                $p = manual_match_payload(body_json());
                $res = Repo::ingestStatMatch([
                    'room'         => Repo::MANUAL_ROOM,
                    'started_at'   => $p['started_at'],
                    'ended_at'     => $p['started_at'],
                    'duration_sec' => 0,
                    'red_score'    => $p['red_score'],
                    'blue_score'   => $p['blue_score'],
                    'winner'       => $p['winner'],
                    'red'          => $p['red'],
                    'blue'         => $p['blue'],
                    'goals'        => [],
                ]);
                out(['id' => $res['id'], 'linked' => $res['linked']], 201);
            }
            if ($method === 'PUT') {
                // Edycja meczu ręcznego (składy + wynik + czas). Tylko mecze dodane ręcznie.
                if ($id <= 0) {
                    err('Brak id meczu.');
                }
                if (Repo::statMatchRoom($id) !== Repo::MANUAL_ROOM) {
                    err('Edytować można tylko mecze dodane ręcznie.', 403);
                }
                $p = manual_match_payload(body_json());
                Repo::updateManualMatch($id, $p);
                out(['ok' => true]);
            }
            if ($method === 'PATCH') {
                if ($id <= 0) {
                    err('Brak id meczu.');
                }
                $b = body_json();
                Repo::setStatMatchTraining($id, !empty($b['is_training']));
                out(['ok' => true]);
            }
            if ($method === 'DELETE') {
                // Usuwanie tylko meczów dodanych ręcznie (na żywo z pokoju → oznacz treningowy).
                if ($id <= 0) {
                    err('Brak id meczu.');
                }
                if (Repo::statMatchRoom($id) !== Repo::MANUAL_ROOM) {
                    err('Usuwać można tylko mecze dodane ręcznie.', 403);
                }
                Repo::deleteStatMatch($id);
                out(['ok' => true]);
            }
            err('Metoda niedozwolona.', 405);

        case 'aliases':
            require_auth();
            if ($method === 'GET') {
                out(Repo::listAliases());
            }
            if ($method === 'POST') {
                $b = body_json();
                $alias = trim((string) ($b['alias'] ?? ''));
                $canonical = trim((string) ($b['canonical'] ?? ''));
                if ($alias === '' || $canonical === '') {
                    err('Podaj oba nicki.');
                }
                if ($alias === $canonical) {
                    err('Nick nie może wskazywać na siebie.');
                }
                Repo::setAlias($alias, $canonical);
                out(['alias' => $alias, 'canonical' => $canonical], 201);
            }
            if ($method === 'DELETE') {
                $alias = (string) ($_GET['alias'] ?? '');
                if ($alias === '') {
                    err('Brak aliasu.');
                }
                Repo::deleteAlias($alias);
                out(['ok' => true]);
            }
            err('Metoda niedozwolona.', 405);

        default:
            err('Nieznany zasób.', 404);
    }
} catch (Throwable $e) {
    err('Błąd serwera: ' . $e->getMessage(), 500);
}
