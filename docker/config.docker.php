<?php
/**
 * Konfiguracja dla developmentu w Dockerze (docker compose up).
 * Montowana do kontenera jako api/config.php (patrz docker-compose.yml).
 *
 * Zawiera WYŁĄCZNIE dane developerskie (host "db" istnieje tylko w sieci
 * compose, hasło logowania to "pitole") — dlatego ten plik JEST w repo.
 * Produkcyjny config tworzysz osobno z config.sample.php.
 */
return [
    'db_dsn'  => 'mysql:host=' . (getenv('DB_HOST') ?: 'db')
               . ';dbname='   . (getenv('DB_NAME') ?: 'pitole')
               . ';charset=utf8mb4',
    'db_user' => getenv('DB_USER') ?: 'pitole',
    'db_pass' => getenv('DB_PASS') ?: 'pitole',

    // hash dev-hasła "pitole"
    'password_hash' => getenv('APP_PASSWORD_HASH')
        ?: '$2y$10$/fgr.bePpSAFp9g1AFQ2y.4O6hwm2H2m9nd0GTcGQsHzbloDpLS5K',
];
