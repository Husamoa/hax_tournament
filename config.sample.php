<?php
/**
 * Pitole — szablon konfiguracji.
 *
 * 1. Skopiuj ten plik do  api/config.php
 * 2. Uzupełnij ścieżkę bazy i hasło ekipy.
 * 3. api/config.php jest w .gitignore — NIE trafia do repozytorium.
 *
 * Hash hasła wygenerujesz komendą:
 *   php -r "echo password_hash('TWOJE_HASLO', PASSWORD_DEFAULT), PHP_EOL;"
 */
return [
    // === Baza danych (SQLite — tak samo lokalnie i na produkcji OVH) ===

    'db_dsn'  => 'sqlite:' . __DIR__ . '/pitole.sqlite',
    'db_user' => null,
    'db_pass' => null,

    // === Dostęp do aplikacji ===

    // Hash wspólnego hasła ekipy (NIE hasło jawnie!). Zob. komentarz na górze.
    'password_hash' => '$2y$10$WSTAW_TUTAJ_WYGENEROWANY_HASH',
];
