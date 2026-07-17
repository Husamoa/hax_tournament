<?php
/**
 * Konfiguracja dla developmentu w Dockerze (docker compose up).
 * Montowana do kontenera jako api/config.php (patrz docker-compose.yml).
 *
 * Zawiera WYŁĄCZNIE dane developerskie (baza SQLite w wolumenie kontenera,
 * hasło logowania to "pitole") — dlatego ten plik JEST w repo.
 * Produkcyjny config tworzysz osobno z config.sample.php.
 *
 * Baza jak na produkcji: SQLite. Plik leży w wolumenie /var/www/data
 * (init: docker/init-db.php przy starcie kontenera).
 */
return [
    'db_dsn'  => 'sqlite:' . (getenv('PITOLE_DB') ?: '/var/www/data/pitole.sqlite'),
    'db_user' => null,
    'db_pass' => null,

    // hash dev-hasła "pitole"
    'password_hash' => getenv('APP_PASSWORD_HASH')
        ?: '$2y$10$/fgr.bePpSAFp9g1AFQ2y.4O6hwm2H2m9nd0GTcGQsHzbloDpLS5K',
];
