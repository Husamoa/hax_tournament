<?php
// Dev (Docker): tworzy bazę SQLite ze schematu przy PIERWSZYM starcie wolumenu.
// Uruchamiane z command w docker-compose.yml, zanim wstanie Apache.
// Reset bazy dev: `docker compose down -v` (kasuje wolumen → baza powstanie od nowa).

$db = getenv('PITOLE_DB') ?: '/var/www/data/pitole.sqlite';
if (!file_exists($db)) {
    (new PDO('sqlite:' . $db))->exec(file_get_contents('/schema.sqlite.sql'));
    fwrite(STDERR, "[pitole] Utworzono bazę SQLite z /schema.sqlite.sql\n");
}
