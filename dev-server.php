<?php
/**
 * Router TYLKO do developmentu lokalnego z wbudowanym serwerem PHP:
 *
 *   php -S localhost:8000 dev-server.php
 *
 * Odtwarza układ produkcyjny (OVH): strona serwowana z katalogu public/ jako "/",
 * a API pod "/api/...". Dzięki temu frontend używa tych samych ścieżek względnych
 * ("api/index.php?...") lokalnie i na produkcji.
 *
 * NA PRODUKCJI ten plik jest nieużywany — Apache serwuje public/ jako web root,
 * a api/ leży obok (patrz docs/deployment-ovh.md).
 */

$uri = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);

// API
if (strpos($uri, '/api/') === 0) {
    require __DIR__ . '/api/index.php';
    return true;
}

// Statyczne pliki z public/
$path = __DIR__ . '/public' . ($uri === '/' ? '/index.html' : $uri);
$real = realpath($path);
if ($real !== false && is_file($real) && strpos($real, realpath(__DIR__ . '/public')) === 0) {
    $ext = strtolower(pathinfo($real, PATHINFO_EXTENSION));
    $mimes = [
        'html' => 'text/html',
        'js'   => 'text/javascript',
        'css'  => 'text/css',
        'json' => 'application/json',
        'svg'  => 'image/svg+xml',
        'ico'  => 'image/x-icon',
        'png'  => 'image/png',
    ];
    if (isset($mimes[$ext])) {
        header('Content-Type: ' . $mimes[$ext] . '; charset=utf-8');
    }
    readfile($real);
    return true;
}

http_response_code(404);
echo 'Not found';
return true;
