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
 *   DELETE api/index.php?r=tournaments&id=ID
 *   POST   api/index.php?r=finish&id=ID     {winner_player_id}
 *   PATCH  api/index.php?r=matches&id=ID    {score_a, score_b}   (null,null = wyczyść)
 *
 * Wszystko poza session/login wymaga zalogowania (wspólne hasło ekipy -> sesja).
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

// --- sesja (bezpieczne cookie; secure tylko pod HTTPS) ---
$secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
    || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
session_set_cookie_params([
    'lifetime' => 60 * 60 * 24 * 30,
    'path'     => '/',
    'secure'   => $secure,
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_name('pitole_sess');
session_start();

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
                    if (!isset($m['teamA'][0], $m['teamA'][1], $m['teamB'][0], $m['teamB'][1])) {
                        err('Niepoprawny format meczu.');
                    }
                }
                $name = isset($b['name']) && trim((string) $b['name']) !== '' ? trim((string) $b['name']) : null;
                $status = ($b['status'] ?? 'active') === 'draft' ? 'draft' : 'active';
                $tid = Repo::createTournament($name, $playerIds, $matches, $status);
                out(Repo::getTournament($tid), 201);
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

        default:
            err('Nieznany zasób.', 404);
    }
} catch (Throwable $e) {
    err('Błąd serwera: ' . $e->getMessage(), 500);
}
