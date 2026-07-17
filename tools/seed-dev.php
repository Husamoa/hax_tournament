<?php
/**
 * Pitole — seed danych testowych (TYLKO DEV).
 *
 * !!! KASUJE zawartość bazy wskazanej przez api/config.php i wypełnia ją danymi testowymi. !!!
 * Nigdy nie uruchamiaj na produkcji.
 *
 * Uruchomienie:
 *   - lokalnie (XAMPP / php -S):   php tools/seed-dev.php
 *   - w Dockerze (compose up):     docker compose exec -u www-data app php /var/www/tools/seed-dev.php
 *
 * Używa klasy Repo (te same, walidowane ścieżki co aplikacja). Baza jest wybierana
 * automatycznie: w kontenerze przez /var/www/api/db.php, lokalnie przez ../api/db.php.
 */
declare(strict_types=1);

// Auto-wykrycie warstwy DB: w kontenerze skrypt leży w /var/www/tools, lokalnie w repo/tools.
require str_starts_with(__DIR__, '/var/www') ? '/var/www/api/db.php' : __DIR__ . '/../api/db.php';

$pdo = DB::pdo();

/* ---------------- reset ---------------- */
$pdo->exec('PRAGMA foreign_keys = OFF');
foreach (['stat_goals','stat_match_players','stat_matches','aliases','matches','tournament_players','tournaments','players'] as $t) {
    $pdo->exec("DELETE FROM $t");
}
$pdo->exec("DELETE FROM sqlite_sequence");
$pdo->exec('PRAGMA foreign_keys = ON');

/* ---------------- gracze ---------------- */
$P = [];
foreach (['Ala','Bea','Cezary','Dawid','Ela','Filip','Grzegorz','Halina'] as $n) {
    $P[$n] = Repo::addPlayer($n, 0)['id'];
}
$P['Krzysiek'] = Repo::addPlayer('Krzysiek', 1)['id']; // gość

/* ---------------- helpers ---------------- */
function ts(int $y,int $m,int $d,int $h=18,int $i=0): int { return mktime($h,$i,0,$m,$d,$y); }
function dtstr(int $y,int $m,int $d,int $h=18,int $i=0): string { return date('Y-m-d H:i:s', mktime($h,$i,0,$m,$d,$y)); }

// zwycięzca (id) wg reguły Pitole: pkt -> bilans -> gole zdobyte
function champion(array $scored): int {
    $pts=[]; $gf=[]; $ga=[];
    foreach ($scored as [$A,$B,$sa,$sb]) {
        foreach ($A as $p){ $pts[$p]=($pts[$p]??0)+($sa>$sb?3:0); $gf[$p]=($gf[$p]??0)+$sa; $ga[$p]=($ga[$p]??0)+$sb; }
        foreach ($B as $p){ $pts[$p]=($pts[$p]??0)+($sb>$sa?3:0); $gf[$p]=($gf[$p]??0)+$sb; $ga[$p]=($ga[$p]??0)+$sa; }
    }
    $ids=array_keys($pts);
    usort($ids, fn($x,$y)=> [$pts[$y],$gf[$y]-$ga[$y],$gf[$y]] <=> [$pts[$x],$gf[$x]-$ga[$x],$gf[$x]]);
    return $ids[0];
}

function playerIdsOf(array $matches): array {
    $s=[];
    foreach ($matches as $m){ foreach (array_merge($m[0],$m[1]) as $id) $s[(int)$id]=true; }
    return array_keys($s);
}

// tworzy turniej, wpisuje wyniki, ustawia datę, opcjonalnie finalizuje
function makeTournament(string $name, array $matches, array $scores, bool $finish, string $when): int {
    $payload = array_map(fn($m)=>['teamA'=>$m[0],'teamB'=>$m[1]], $matches);
    $tid = Repo::createTournament($name, playerIdsOf($matches), $payload, 'active');
    $t = Repo::getTournament($tid);
    $scored = [];
    foreach ($t['matches'] as $i => $mm) {
        if (array_key_exists($i,$scores) && $scores[$i] !== null) {
            [$sa,$sb] = $scores[$i];
            Repo::setScore((int)$mm['id'], $sa, $sb);
            $scored[] = [$mm['teamA'], $mm['teamB'], $sa, $sb];
        }
    }
    DB::pdo()->prepare('UPDATE tournaments SET created_at=? WHERE id=?')->execute([$when, $tid]);
    if ($finish) {
        Repo::finishTournament($tid, $scored ? champion($scored) : null);
        DB::pdo()->prepare('UPDATE tournaments SET finished_at=? WHERE id=?')->execute([$when, $tid]);
    }
    return $tid;
}

function live(string $room,int $when,array $red,array $blue,int $sa,int $sb,array $goals=[]): array {
    return Repo::ingestStatMatch([
        'room'=>$room,'started_at'=>$when,'ended_at'=>$when+600,'duration_sec'=>600,
        'red_score'=>$sa,'blue_score'=>$sb,'winner'=>$sa>$sb?'red':'blue',
        'red'=>$red,'blue'=>$blue,'goals'=>$goals,
    ]);
}
function manual(int $when,array $red,array $blue,int $sa,int $sb): array {
    return Repo::ingestStatMatch([
        'room'=>Repo::MANUAL_ROOM,'started_at'=>$when,'ended_at'=>$when+600,'duration_sec'=>600,
        'red_score'=>$sa,'blue_score'=>$sb,'winner'=>$sa>$sb?'red':'blue',
        'red'=>$red,'blue'=>$blue,'goals'=>[],
    ]);
}
$g = fn(float $t,string $team,?string $scorer,?string $assist=null)=>['time'=>$t,'team'=>$team,'scorer'=>$scorer,'assist'=>$assist,'own_goal'=>false];

/* ---------------- alias (scalanie nicków) ---------------- */
Repo::setAlias('Alicja', 'Ala'); // stary nick Ali

/* ---------------- turnieje ---------------- */
// T1 — 2v2, zakończony (Ala, Bea, Cezary, Dawid)
makeTournament('Turniej środowy', [
    [[$P['Ala'],$P['Bea']],    [$P['Cezary'],$P['Dawid']]],
    [[$P['Ala'],$P['Cezary']], [$P['Bea'],$P['Dawid']]],
    [[$P['Ala'],$P['Dawid']],  [$P['Bea'],$P['Cezary']]],
], [[10,6],[8,10],[10,7]], true, dtstr(2026,7,10,19));

// T2 — 2v2, zakończony (Ela, Filip, Grzegorz, Halina)
makeTournament('Turniej piątkowy', [
    [[$P['Ela'],$P['Filip']],    [$P['Grzegorz'],$P['Halina']]],
    [[$P['Ela'],$P['Grzegorz']], [$P['Filip'],$P['Halina']]],
    [[$P['Ela'],$P['Halina']],   [$P['Filip'],$P['Grzegorz']]],
], [[7,5],[4,6],[10,8]], true, dtstr(2026,7,12,20));

// T3 — 3v3, zakończony (6 graczy: każda trójka gra raz -> 10 meczów)
$six = [$P['Ala'],$P['Bea'],$P['Cezary'],$P['Dawid'],$P['Ela'],$P['Filip']];
$rest = array_slice($six,1);
$T3 = [];
for ($a=0;$a<count($rest);$a++) {
    for ($b=$a+1;$b<count($rest);$b++) {
        $teamA = [$six[0],$rest[$a],$rest[$b]];
        $teamB = array_values(array_diff($six,$teamA));
        $T3[] = [$teamA,$teamB];
    }
}
$T3s = [[3,1],[2,4],[5,2],[1,3],[4,2],[3,5],[6,3],[2,1],[1,4],[5,4]];
makeTournament('Liga 3v3', $T3, $T3s, true, dtstr(2026,7,14,18));

// T4 — 2v2, AKTYWNY (w toku): 2 mecze rozegrane, 1 do rozegrania
makeTournament('Turniej na żywo (w toku)', [
    [[$P['Ala'],$P['Cezary']],  [$P['Ela'],$P['Grzegorz']]],
    [[$P['Ala'],$P['Ela']],     [$P['Cezary'],$P['Grzegorz']]],
    [[$P['Ala'],$P['Grzegorz']],[$P['Cezary'],$P['Ela']]],
], [[10,6],[8,9],null], false, dtstr(2026,7,17,19));

/* ---------------- statystyki: mecze name-based ---------------- */
// na żywo (z pokoju), z golami
live('Pitole #1', ts(2026,7,15,19,0), ['Ala','Bea'], ['Cezary','Dawid'], 3,2, [
    $g(65,'red','Ala','Bea'), $g(140,'blue','Cezary'), $g(205,'red','Bea','Ala'),
    $g(260,'blue','Dawid','Cezary'), $g(320,'red','Ala'),
]);
live('Pitole #1', ts(2026,7,15,19,25), ['Ela','Filip'], ['Grzegorz','Halina'], 5,1, [
    $g(30,'red','Filip','Ela'), $g(95,'red','Ela'), $g(150,'blue','Grzegorz'),
    $g(210,'red','Ela','Filip'), $g(280,'red','Filip'), $g(350,'red','Ela'),
]);
live('Pitole #2', ts(2026,7,16,20,0), ['Ala','Cezary'], ['Bea','Filip'], 2,4);
live('Pitole #2', ts(2026,7,16,20,30), ['Alicja','Dawid'], ['Ela','Grzegorz'], 3,1); // Alicja -> Ala (alias)

// dodane ręcznie
manual(ts(2026,7,13,21,0), ['Bea','Grzegorz'], ['Cezary','Ela'], 6,3);
$tr = manual(ts(2026,7,11,18,0), ['Ala','Halina'], ['Dawid','Filip'], 4,2);
Repo::setStatMatchTraining((int)$tr['id'], true); // oznacz treningowy (nie liczony)

/* ---------------- podsumowanie ---------------- */
$q = fn(string $sql)=>DB::pdo()->query($sql)->fetchColumn();
echo "OK — dane testowe wgrane:\n";
echo "  gracze:        ", $q('SELECT COUNT(*) FROM players'), "\n";
echo "  turnieje:      ", $q('SELECT COUNT(*) FROM tournaments'),
     " (aktywne: ", $q("SELECT COUNT(*) FROM tournaments WHERE status='active'"),
     ", zakończone: ", $q("SELECT COUNT(*) FROM tournaments WHERE status='finished'"), ")\n";
echo "  mecze turniej: ", $q('SELECT COUNT(*) FROM matches'), "\n";
echo "  mecze staty:   ", $q('SELECT COUNT(*) FROM stat_matches'),
     " (ręczne: ", $q("SELECT COUNT(*) FROM stat_matches WHERE room='ręczny'"),
     ", treningowe: ", $q('SELECT COUNT(*) FROM stat_matches WHERE is_training=1'), ")\n";
echo "  gole:          ", $q('SELECT COUNT(*) FROM stat_goals'), "\n";
echo "  aliasy:        ", $q('SELECT COUNT(*) FROM aliases'), "\n";
