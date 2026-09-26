<?php
declare(strict_types=1);

/**
 * Collector: fragt alle aktiven Nodes ab, speichert Messwerte, verwaltet Online-/Offline-Status,
 * verdichtet alte Rohdaten und räumt nach Retention auf.
 */

require_once __DIR__ . '/nodes.php';

const QB_OFFLINE_AFTER_FAILURES = 2;   // erst nach 2 Fehlversuchen in Folge gilt eine Node als offline
const QB_INFO_REFRESH_SECONDS   = 900; // /api/v1/info alle 15 Minuten aktualisieren

/**
 * Pollt eine einzelne Node inklusive einmaligem Sofort-Retry.
 * @return array{ok:bool, error:?string, ms:int}
 */
function qb_collector_poll_node(array $node): array
{
    $client = qb_node_client($node);
    $now = time();
    if ($client === null) {
        qb_collector_store_failure($node, 'API-Schlüssel kann nicht entschlüsselt werden (APP_SECRET geändert?)', $now);
        return ['ok' => false, 'error' => 'API-Schlüssel nicht lesbar', 'ms' => 0];
    }

    $res = $client->status();
    if (!$res['ok'] && $res['status'] === 0) {
        // Netzwerkfehler: kurzer Retry, um kurze Aussetzer nicht als Ausfall zu werten
        usleep(500000);
        $res = $client->status();
    }

    if (!$res['ok']) {
        qb_collector_store_failure($node, (string)$res['error'], $now);
        return ['ok' => false, 'error' => $res['error'], 'ms' => $res['ms']];
    }

    $info = null;
    $infoAge = $node['info_json'] ? $now - (int)$node['updated_at'] : PHP_INT_MAX;
    if ($node['info_json'] === null || $node['hostname'] === null || $infoAge > QB_INFO_REFRESH_SECONDS || $node['status'] !== 'online') {
        $ir = $client->info();
        if ($ir['ok']) {
            $info = $ir['data'];
        }
    }

    qb_collector_store_result((int)$node['id'], $res['data'], $info, $now, $node);

    // Docker-Host: Container der Node abrufen und cachen (falls das Docker-Modul aktiv ist)
    try {
        qb_collector_store_containers((int)$node['id'], $client, $now);
    } catch (Throwable $e) {
        qb_log(sprintf('Node #%d (%s): Docker-Container-Abruf fehlgeschlagen: %s', $node['id'], $node['name'], $e->getMessage()));
    }

    return ['ok' => true, 'error' => null, 'ms' => $res['ms']];
}

/**
 * Ruft /api/v1/docker/containers einer Node ab und hält den lokalen Cache
 * (node_containers) aktuell. Ist Docker auf der Node nicht aktiviert, wird der
 * Cache für diese Node geleert, damit keine veralteten Einträge bestehen bleiben.
 */
function qb_collector_store_containers(int $nodeId, QuickinfoClient $client, int $now): void
{
    $res = $client->dockerContainers();
    $db = qb_db();

    if (!$res['ok']) {
        // Kein Docker-Host oder Modul deaktiviert: veraltete Einträge entfernen
        $db->prepare('DELETE FROM node_containers WHERE node_id = ?')->execute([$nodeId]);
        return;
    }

    $containers = $res['data']['containers'] ?? null;
    if (!is_array($containers)) {
        $db->prepare('DELETE FROM node_containers WHERE node_id = ?')->execute([$nodeId]);
        return;
    }

    $db->beginTransaction();
    try {
        $db->prepare('DELETE FROM node_containers WHERE node_id = ?')->execute([$nodeId]);
        $ins = $db->prepare(
            'INSERT INTO node_containers (node_id, container_id, name, image, state, status, ports, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        );
        foreach ($containers as $c) {
            if (!is_array($c) || !isset($c['id'])) {
                continue;
            }
            $ins->execute([
                $nodeId,
                substr((string)$c['id'], 0, 64),
                substr((string)($c['name'] ?? $c['id']), 0, 255),
                isset($c['image']) ? substr((string)$c['image'], 0, 255) : null,
                isset($c['state']) ? substr((string)$c['state'], 0, 32) : null,
                isset($c['status']) ? substr((string)$c['status'], 0, 255) : null,
                isset($c['ports']) ? json_encode($c['ports'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null,
                $now,
            ]);
        }
        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        throw $e;
    }
}

/**
 * Schreibt einen erfolgreichen Status-Abruf in die DB: Snapshot, Metriken, Dienste, Statuswechsel.
 */
function qb_collector_store_result(int $nodeId, array $status, ?array $info, int $now, ?array $prev = null): void
{
    $db = qb_db();
    $prev ??= qb_node_row($nodeId);
    $db->beginTransaction();
    try {
        $sql = 'UPDATE nodes SET status = ?, consecutive_failures = 0, last_error = NULL, last_poll = ?, last_seen = ?,
                       hostname = ?, snapshot_json = ?, snapshot_ts = ?';
        $params = [
            'online', $now, $now,
            substr((string)($status['hostname'] ?? ($info['hostname'] ?? '')), 0, 255),
            json_encode($status, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            $now,
        ];
        if ($info !== null) {
            $sql .= ', info_json = ?, updated_at = ?';
            $params[] = json_encode($info, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            $params[] = $now;
        }
        $sql .= ' WHERE id = ?';
        $params[] = $nodeId;
        $db->prepare($sql)->execute($params);

        qb_collector_store_metrics($nodeId, qb_collector_extract_metrics($status), $now);
        qb_collector_store_services($nodeId, $status['services']['items'] ?? [], $now, $prev);

        if ($prev && $prev['status'] !== 'online') {
            $msg = $prev['status'] === 'unknown' ? 'Node gekoppelt und erreichbar' : 'Node ist wieder erreichbar';
            qb_collector_event($nodeId, $now, 'online', $msg);
        }
        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        throw $e;
    }
}

function qb_collector_store_failure(array $node, string $error, int $now): void
{
    $db = qb_db();
    $failures = (int)$node['consecutive_failures'] + 1;
    $wasOnline = $node['status'] === 'online';
    $newStatus = ($failures >= QB_OFFLINE_AFTER_FAILURES || $node['status'] === 'unknown') ? 'offline' : $node['status'];

    $db->prepare(
        'UPDATE nodes SET status = ?, consecutive_failures = ?, last_error = ?, last_poll = ? WHERE id = ?'
    )->execute([$newStatus, $failures, substr($error, 0, 512), $now, $node['id']]);

    qb_collector_store_metrics((int)$node['id'], ['online' => 0.0], $now);

    if ($wasOnline && $newStatus === 'offline') {
        qb_collector_event((int)$node['id'], $now, 'offline', 'Node nicht erreichbar: ' . $error);
    }
}

/**
 * Extrahiert flache Metriken aus /api/v1/status.
 * @return array<string,float>
 */
function qb_collector_extract_metrics(array $s): array
{
    $m = ['online' => 1.0];
    if (isset($s['cpu']['utilization'])) {
        $m['cpu.total'] = (float)$s['cpu']['utilization'];
    }
    foreach ($s['cpu']['cores'] ?? [] as $i => $v) {
        if ($v !== null) {
            $m['cpu.core.' . (int)$i] = (float)$v;
        }
    }
    if (isset($s['cpu']['temperature'])) {
        $m['temp.max'] = (float)$s['cpu']['temperature'];
    }
    foreach ($s['cpu']['sensors'] ?? [] as $t) {
        if (isset($t['key'], $t['value'])) {
            $m[substr((string)$t['key'], 0, 48)] = (float)$t['value'];
        }
    }
    if (isset($s['memory']['pct'])) {
        $m['mem.used_pct'] = (float)$s['memory']['pct'];
    }
    if (isset($s['disk']['pct'])) {
        $m['disk.used_pct'] = (float)$s['disk']['pct'];
    }
    if (is_array($s['load'] ?? null)) {
        foreach ([0 => 'load.1', 1 => 'load.5', 2 => 'load.15'] as $i => $k) {
            if (isset($s['load'][$i])) {
                $m[$k] = (float)$s['load'][$i];
            }
        }
    }
    foreach ($s['gpus'] ?? [] as $g) {
        $idx = (int)($g['index'] ?? 0);
        foreach (['utilization' => 'util', 'temperature' => 'temp', 'memory_pct' => 'mem_pct', 'power_w' => 'power'] as $src => $dst) {
            if (isset($g[$src])) {
                $m['gpu.' . $idx . '.' . $dst] = (float)$g[$src];
            }
        }
    }
    if (isset($s['services']['down'])) {
        $m['services.down'] = (float)$s['services']['down'];
    }
    return $m;
}

function qb_collector_store_metrics(int $nodeId, array $metrics, int $ts): void
{
    if (!$metrics) {
        return;
    }
    $stmt = qb_db()->prepare(
        'INSERT INTO node_metrics (node_id, metric, ts, value) VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE value = VALUES(value)'
    );
    foreach ($metrics as $k => $v) {
        if (is_finite($v)) {
            $stmt->execute([$nodeId, $k, $ts, $v]);
        }
    }
}

function qb_collector_store_services(int $nodeId, array $items, int $now, ?array $prev): void
{
    $db = qb_db();
    $before = [];
    $stmt = $db->prepare('SELECT name, active FROM node_services WHERE node_id = ?');
    $stmt->execute([$nodeId]);
    foreach ($stmt as $r) {
        $before[$r['name']] = $r['active'] === null ? null : (bool)$r['active'];
    }

    $seen = [];
    $ins = $db->prepare(
        'INSERT INTO node_services (node_id, name, display_name, active, state, uptime_24h, last_check, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE display_name = VALUES(display_name), active = VALUES(active), state = VALUES(state),
                                 uptime_24h = VALUES(uptime_24h), last_check = VALUES(last_check), updated_at = VALUES(updated_at)'
    );
    foreach ($items as $svc) {
        $name = substr((string)($svc['name'] ?? ''), 0, 128);
        if ($name === '') {
            continue;
        }
        $active = array_key_exists('active', $svc) && $svc['active'] !== null ? ((bool)$svc['active'] ? 1 : 0) : null;
        $seen[$name] = true;
        $ins->execute([
            $nodeId, $name, substr((string)($svc['display_name'] ?? $name), 0, 128), $active,
            isset($svc['state']) ? substr((string)$svc['state'], 0, 64) : null,
            isset($svc['uptime_24h']) ? (float)$svc['uptime_24h'] : null,
            isset($svc['last_check']) ? (int)$svc['last_check'] : null,
            $now,
        ]);

        $label = (string)($svc['display_name'] ?? $name);
        if ($active === 0 && ($before[$name] ?? true) !== false) {
            qb_collector_event($nodeId, $now, 'service_down', 'Dienst "' . $label . '" ist ausgefallen');
        } elseif ($active === 1 && ($before[$name] ?? null) === false) {
            qb_collector_event($nodeId, $now, 'service_up', 'Dienst "' . $label . '" läuft wieder');
        }
    }

    // Auf der Node entfernte Dienste auch hier entfernen
    $gone = array_diff(array_keys($before), array_keys($seen));
    if ($gone) {
        $del = $db->prepare('DELETE FROM node_services WHERE node_id = ? AND name = ?');
        foreach ($gone as $name) {
            $del->execute([$nodeId, $name]);
        }
    }
}

function qb_collector_event(int $nodeId, int $ts, string $type, string $message): void
{
    qb_db()->prepare('INSERT INTO node_events (node_id, ts, type, message) VALUES (?, ?, ?, ?)')
        ->execute([$nodeId, $ts, $type, substr($message, 0, 512)]);
}

/**
 * Ein kompletter Durchlauf über alle aktiven Nodes.
 * @return array{polled:int, online:int, offline:int}
 */
function qb_collector_run(bool $verbose = false): array
{
    $nodes = qb_db()->query('SELECT * FROM nodes WHERE enabled = 1 ORDER BY sort_order, id')->fetchAll();
    $stats = ['polled' => 0, 'online' => 0, 'offline' => 0];
    foreach ($nodes as $node) {
        $stats['polled']++;
        try {
            $r = qb_collector_poll_node($node);
        } catch (Throwable $e) {
            $r = ['ok' => false, 'error' => 'Interner Fehler: ' . $e->getMessage(), 'ms' => 0];
            qb_log(sprintf('Node #%d (%s): %s', $node['id'], $node['name'], $e->getMessage()));
        }
        $stats[$r['ok'] ? 'online' : 'offline']++;
        if ($verbose) {
            qb_log(sprintf('Node #%d %-24s %s (%d ms)%s', $node['id'], $node['name'], $r['ok'] ? 'online ' : 'OFFLINE', $r['ms'], $r['ok'] ? '' : ' – ' . $r['error']));
        }
    }
    return $stats;
}

/**
 * Verdichtet Rohdaten älter als 1 Stunde in 10-Minuten-Buckets und löscht Daten nach Retention.
 */
function qb_collector_maintenance(bool $verbose = false): void
{
    $db = qb_db();
    $cfg = qb_config()['retention'];
    $now = time();

    $aggUntil = (int)qb_meta_get('agg_until', '0');
    $target = (int)(floor(($now - 3600) / QB_AGG_BUCKET) * QB_AGG_BUCKET);
    if ($aggUntil === 0) {
        $first = $db->query('SELECT MIN(ts) FROM node_metrics')->fetchColumn();
        $aggUntil = $first ? (int)(floor((int)$first / QB_AGG_BUCKET) * QB_AGG_BUCKET) : $target;
    }

    if ($target > $aggUntil) {
        $stmt = $db->prepare(
            'INSERT INTO node_metrics_agg (node_id, metric, ts, avg_value, min_value, max_value, samples)
             SELECT node_id, metric, FLOOR(ts / :b1) * :b2, AVG(value), MIN(value), MAX(value), COUNT(*)
               FROM node_metrics
              WHERE ts >= :from AND ts < :to
           GROUP BY node_id, metric, FLOOR(ts / :b3)
             ON DUPLICATE KEY UPDATE avg_value = VALUES(avg_value), min_value = VALUES(min_value),
                                     max_value = VALUES(max_value), samples = VALUES(samples)'
        );
        $stmt->bindValue(':b1', QB_AGG_BUCKET, PDO::PARAM_INT);
        $stmt->bindValue(':b2', QB_AGG_BUCKET, PDO::PARAM_INT);
        $stmt->bindValue(':b3', QB_AGG_BUCKET, PDO::PARAM_INT);
        $stmt->bindValue(':from', $aggUntil, PDO::PARAM_INT);
        $stmt->bindValue(':to', $target, PDO::PARAM_INT);
        $stmt->execute();
        $rows = $stmt->rowCount();
        qb_meta_set('agg_until', (string)$target);
        if ($verbose) {
            qb_log(sprintf('Aggregation: %d Buckets bis %s', $rows, date('Y-m-d H:i', $target)));
        }
    }

    $rawCut = $now - $cfg['raw_days'] * 86400;
    $aggCut = $now - $cfg['agg_days'] * 86400;
    $d1 = $db->prepare('DELETE FROM node_metrics WHERE ts < ? LIMIT 50000');
    $d1->execute([$rawCut]);
    $d2 = $db->prepare('DELETE FROM node_metrics_agg WHERE ts < ? LIMIT 50000');
    $d2->execute([$aggCut]);
    $d3 = $db->prepare('DELETE FROM node_events WHERE ts < ?');
    $d3->execute([$aggCut]);
    $db->prepare('DELETE FROM login_attempts WHERE last_attempt < ?')->execute([$now - 86400]);
    if ($verbose) {
        qb_log(sprintf('Retention: %d Rohdaten, %d Aggregate gelöscht', $d1->rowCount(), $d2->rowCount()));
    }
    qb_meta_set('maintenance_at', (string)$now);
}
