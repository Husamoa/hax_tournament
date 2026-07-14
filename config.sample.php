<?php
/**
 * Pitole — szablon konfiguracji.
 *
 * 1. Skopiuj ten plik do  api/config.php
 * 2. Uzupełnij dane bazy i hasło ekipy.
 * 3. api/config.php jest w .gitignore — NIE trafia do repozytorium.
 *
 * Hash hasła wygenerujesz komendą:
 *   php -r "echo password_hash('TWOJE_HASLO', PASSWORD_DEFAULT), PHP_EOL;"
 */
return [
    // === Baza danych ===

    // --- Produkcja: MySQL na OVH (dane z OVH Manager → Bazy danych) ---
    'db_dsn'  => 'mysql:host=HOST_OVH;dbname=NAZWA_BAZY;charset=utf8mb4',
    'db_user' => 'UZYTKOWNIK_BAZY',
    'db_pass' => 'HASLO_BAZY',

    // --- Development: SQLite (zakomentuj MySQL powyżej i odkomentuj to) ---
    // 'db_dsn'  => 'sqlite:' . __DIR__ . '/pitole.sqlite',
    // 'db_user' => null,
    // 'db_pass' => null,

    // === Dostęp do aplikacji ===

    // Hash wspólnego hasła ekipy (NIE hasło jawnie!). Zob. komentarz na górze.
    'password_hash' => '$2y$10$WSTAW_TUTAJ_WYGENEROWANY_HASH',
];
