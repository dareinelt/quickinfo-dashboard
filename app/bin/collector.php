#!/usr/bin/env php
<?php
declare(strict_types=1);

/**
 * quickinfo Management-Board – Collector (CLI)
 *
 *   php bin/collector.php                 einmaliger Durchlauf über alle Nodes
 *   php bin/collector.php --daemon        Endlosschleife im Intervall COLLECTOR_INTERVAL
 *   php bin/collector.php --maintenance   nur Aggregation/Retention ausführen
 *   php bin/collector.php --verbose       ausführliche Ausgabe
 */

if (PHP_SAPI !== 'cli') {
    exit(1);
}

require_once dirname(__DIR__) . '/src/bootstrap.php';
require_once dirname(__DIR__) . '/src/collector.php';

$args = array_slice($argv, 1);
$daemon = in_array('--daemon', $args, true);
$verbose = in_array('--verbose', $args, true) || $daemon;
$onlyMaintenance = in_array('--maintenance', $args, true);

$interval = qb_config()['collector']['interval'];
$running = true;
if (function_exists('pcntl_signal')) {
    pcntl_async_signals(true);
    pcntl_signal(SIGTERM, static function () use (&$running) { $running = false; });
    pcntl_signal(SIGINT, static function () use (&$running) { $running = false; });
}

qb_log(sprintf('Collector gestartet (Intervall %ds, Timeout %ds%s)', $interval, qb_config()['collector']['timeout'], $daemon ? ', Daemon' : ''));

if ($onlyMaintenance) {
    qb_collector_maintenance(true);
    exit(0);
}

$lastMaintenance = (int)qb_meta_get('maintenance_at', '0');

do {
    $start = microtime(true);
    try {
        $stats = qb_collector_run($verbose);
        qb_meta_set('collector_heartbeat', (string)time());
        if ($verbose) {
            qb_log(sprintf('Durchlauf: %d Nodes, %d online, %d offline (%.1fs)', $stats['polled'], $stats['online'], $stats['offline'], microtime(true) - $start));
        }
        if (time() - $lastMaintenance >= 3600) {
            qb_collector_maintenance($verbose);
            $lastMaintenance = time();
        }
    } catch (Throwable $e) {
        qb_log('Fehler: ' . $e->getMessage());
        if (!$daemon) {
            exit(1);
        }
    }

    if ($daemon && $running) {
        $sleep = $interval - (microtime(true) - $start);
        // in kleinen Schritten schlafen, damit SIGTERM zeitnah wirkt
        while ($sleep > 0 && $running) {
            $chunk = min(1.0, $sleep);
            usleep((int)($chunk * 1000000));
            $sleep -= $chunk;
        }
    }
} while ($daemon && $running);

qb_log('Collector beendet.');
