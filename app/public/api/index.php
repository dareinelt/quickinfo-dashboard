<?php
declare(strict_types=1);

/**
 * API-Einstiegspunkt – einzige PHP-Datei im Webroot.
 */

require_once dirname(__DIR__, 2) . '/src/bootstrap.php';
require_once dirname(__DIR__, 2) . '/src/api.php';

set_exception_handler(static function (Throwable $e): void {
    error_log('[qiboard] ' . get_class($e) . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    qb_json_error('Interner Serverfehler.', 500);
});

qb_api_dispatch();
