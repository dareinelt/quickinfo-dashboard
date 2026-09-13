<?php
declare(strict_types=1);

/**
 * Node-Verwaltung: Anlegen, Bearbeiten, Löschen, Verbindungstest, Ausgabeformat.
 */

function qb_node_row(int $id): ?array
{
    $stmt = qb_db()->prepare('SELECT * FROM nodes WHERE id = ?');
    $stmt->execute([$id]);
    return $stmt->fetch() ?: null;
}

function qb_node_api_key(array $node): ?string
{
    return qb_decrypt((string)$node['api_key_enc']);
}

function qb_node_client(array $node): ?QuickinfoClient
{
    $key = qb_node_api_key($node);
    if ($key === null) {
        return null;
    }
    return new QuickinfoClient((string)$node['url'], $key, (bool)$node['verify_tls'], qb_config()['collector']['timeout']);
}

/**
 * Validiert die Eingaben eines Node-Formulars.
 * @return array{name:string,url:string,api_key:?string,verify_tls:int,enabled:int,sort_order:int}
 */
function qb_node_validate(array $in, bool $requireKey): array
{
    $name = trim((string)($in['name'] ?? ''));
    if ($name === '' || mb_strlen($name) > 128) {
        qb_json_error('Bitte einen Namen (max. 128 Zeichen) angeben.', 422, ['field' => 'name']);
    }
    $url = qb_normalize_url((string)($in['url'] ?? ''));
    if ($url === null) {
        qb_json_error('Bitte eine gültige IP-Adresse, einen Hostnamen oder eine URL angeben.', 422, ['field' => 'url']);
    }
    $key = isset($in['api_key']) ? trim((string)$in['api_key']) : '';
    if ($requireKey && $key === '') {
        qb_json_error('Bitte den API-Schlüssel der quickinfo-Instanz angeben.', 422, ['field' => 'api_key']);
    }
    if ($key !== '' && (strlen($key) < 16 || strlen($key) > 255 || !preg_match('/^[A-Za-z0-9._\-]+$/', $key))) {
        qb_json_error('Der API-Schlüssel hat ein ungültiges Format.', 422, ['field' => 'api_key']);
    }
    return [
        'name'       => $name,
        'url'        => $url,
        'api_key'    => $key !== '' ? $key : null,
        'verify_tls' => !empty($in['verify_tls']) ? 1 : 0,
        'enabled'    => array_key_exists('enabled', $in) ? (!empty($in['enabled']) ? 1 : 0) : 1,
        'sort_order' => (int)($in['sort_order'] ?? 0),
    ];
}

/**
 * Führt einen Verbindungstest gegen /api/v1/info und /api/v1/status aus.
 * @return array{ok:bool, error:?string, ms:int, info:?array, status:?array}
 */
function qb_node_test(string $url, string $apiKey, bool $verifyTls): array
{
    $client = new QuickinfoClient($url, $apiKey, $verifyTls, min(8, qb_config()['collector']['timeout']));
    $info = $client->info();
    if (!$info['ok']) {
        return ['ok' => false, 'error' => $info['error'], 'ms' => $info['ms'], 'info' => null, 'status' => null];
    }
    if (!isset($info['data']['hostname']) || !array_key_exists('uptime', $info['data'])) {
        return ['ok' => false, 'error' => 'Antwort sieht nicht nach einer quickinfo-Instanz aus.', 'ms' => $info['ms'], 'info' => null, 'status' => null];
    }
    $status = $client->status();
    if (!$status['ok']) {
        return ['ok' => false, 'error' => $status['error'], 'ms' => $status['ms'], 'info' => $info['data'], 'status' => null];
    }
    return ['ok' => true, 'error' => null, 'ms' => $info['ms'] + $status['ms'], 'info' => $info['data'], 'status' => $status['data']];
}

function qb_node_create(array $v, ?array $test): int
{
    $now = time();
    $db = qb_db();
    $stmt = $db->prepare(
        'INSERT INTO nodes (name, url, api_key_enc, api_key_prefix, verify_tls, enabled, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        $v['name'], $v['url'], qb_encrypt((string)$v['api_key']), qb_key_prefix((string)$v['api_key']),
        $v['verify_tls'], $v['enabled'], $v['sort_order'], $now, $now,
    ]);
    $id = (int)$db->lastInsertId();
    if ($test && $test['ok']) {
        require_once __DIR__ . '/collector.php';
        qb_collector_store_result($id, $test['status'], $test['info'], $now);
    }
    return $id;
}

function qb_node_update(int $id, array $v): void
{
    $sql = 'UPDATE nodes SET name = ?, url = ?, verify_tls = ?, enabled = ?, sort_order = ?, updated_at = ?';
    $params = [$v['name'], $v['url'], $v['verify_tls'], $v['enabled'], $v['sort_order'], time()];
    if ($v['api_key'] !== null) {
        $sql .= ', api_key_enc = ?, api_key_prefix = ?, consecutive_failures = 0, last_error = NULL';
        $params[] = qb_encrypt($v['api_key']);
        $params[] = qb_key_prefix($v['api_key']);
    }
    $sql .= ' WHERE id = ?';
    $params[] = $id;
    qb_db()->prepare($sql)->execute($params);
}

function qb_node_delete(int $id): void
{
    qb_db()->prepare('DELETE FROM nodes WHERE id = ?')->execute([$id]);
}

/** Liest die Dienste einer Node. */
function qb_node_services(int $nodeId): array
{
    $stmt = qb_db()->prepare(
        'SELECT name, display_name, active, state, uptime_24h, last_check
           FROM node_services WHERE node_id = ? ORDER BY display_name'
    );
    $stmt->execute([$nodeId]);
    $out = [];
    foreach ($stmt as $r) {
        $out[] = [
            'name'         => $r['name'],
            'display_name' => $r['display_name'],
            'active'       => $r['active'] === null ? null : (bool)$r['active'],
            'state'        => $r['state'],
            'uptime_24h'   => $r['uptime_24h'] === null ? null : (float)$r['uptime_24h'],
            'last_check'   => $r['last_check'] === null ? null : (int)$r['last_check'],
        ];
    }
    return $out;
}

/**
 * Wandelt eine DB-Zeile in das Ausgabeformat für das Frontend um.
 * $full = true liefert zusätzlich den gesamten Snapshot (Kerne, Sensoren, GPUs) und die Metadaten.
 */
function qb_node_present(array $n, bool $full = false): array
{
    $snap = $n['snapshot_json'] ? json_decode((string)$n['snapshot_json'], true) : null;
    $info = $n['info_json'] ? json_decode((string)$n['info_json'], true) : null;
    $snap = is_array($snap) ? $snap : null;
    $info = is_array($info) ? $info : null;
    $now = time();

    $gpus = $snap['gpus'] ?? [];
    $gpuUtil = null;
    $gpuTemp = null;
    foreach ($gpus as $g) {
        if (isset($g['utilization'])) {
            $gpuUtil = max((float)$gpuUtil, (float)$g['utilization']);
        }
        if (isset($g['temperature'])) {
            $gpuTemp = max((float)$gpuTemp, (float)$g['temperature']);
        }
    }

    $services = qb_node_services((int)$n['id']);
    $svcTotal = count($services);
    $svcDown = count(array_filter($services, static fn($s) => $s['active'] === false));

    // Uptime: Basis aus dem letzten Snapshot plus seither vergangene Zeit (nur wenn online)
    $uptime = null;
    if (isset($snap['uptime']) && $n['status'] === 'online' && $n['snapshot_ts']) {
        $uptime = (int)$snap['uptime'] + max(0, $now - (int)$n['snapshot_ts']);
    } elseif (isset($snap['uptime'])) {
        $uptime = (int)$snap['uptime'];
    }

    $out = [
        'id'           => (int)$n['id'],
        'name'         => $n['name'],
        'url'          => $n['url'],
        'hostname'     => $n['hostname'],
        'api_key_prefix' => $n['api_key_prefix'],
        'verify_tls'   => (bool)$n['verify_tls'],
        'enabled'      => (bool)$n['enabled'],
        'sort_order'   => (int)$n['sort_order'],
        'status'       => $n['enabled'] ? $n['status'] : 'disabled',
        'consecutive_failures' => (int)$n['consecutive_failures'],
        'last_error'   => $n['last_error'],
        'last_poll'    => $n['last_poll'] === null ? null : (int)$n['last_poll'],
        'last_seen'    => $n['last_seen'] === null ? null : (int)$n['last_seen'],
        'snapshot_ts'  => $n['snapshot_ts'] === null ? null : (int)$n['snapshot_ts'],
        'uptime'       => $uptime,
        'summary' => [
            'cpu'         => $snap['cpu']['utilization'] ?? null,
            'cpu_count'   => $snap['cpu']['count'] ?? ($info['cpu']['cores'] ?? null),
            'temp'        => $snap['cpu']['temperature'] ?? null,
            'gpu'         => $gpuUtil,
            'gpu_temp'    => $gpuTemp,
            'gpu_count'   => count($gpus),
            'mem_pct'     => $snap['memory']['pct'] ?? null,
            'mem_total'   => $snap['memory']['total'] ?? null,
            'mem_used'    => $snap['memory']['used'] ?? null,
            'disk_pct'    => $snap['disk']['pct'] ?? null,
            'disk_total'  => $snap['disk']['total'] ?? null,
            'disk_available' => $snap['disk']['available'] ?? null,
            'disk_mount'  => $snap['disk']['mount'] ?? '/',
            'load'        => $snap['load'] ?? null,
            'services_total' => $svcTotal,
            'services_down'  => $svcDown,
        ],
        'created_at'   => (int)$n['created_at'],
        'updated_at'   => (int)$n['updated_at'],
    ];

    if ($full) {
        $out['snapshot'] = $snap;
        $out['info'] = $info;
        $out['services'] = $services;
    }
    return $out;
}

function qb_nodes_list(bool $full = false): array
{
    $rows = qb_db()->query('SELECT * FROM nodes ORDER BY sort_order, name')->fetchAll();
    return array_map(static fn(array $r) => qb_node_present($r, $full), $rows);
}

function qb_node_events(int $nodeId, int $limit = 50): array
{
    $stmt = qb_db()->prepare('SELECT ts, type, message FROM node_events WHERE node_id = ? ORDER BY ts DESC, id DESC LIMIT ' . (int)$limit);
    $stmt->execute([$nodeId]);
    return array_map(static fn($r) => ['ts' => (int)$r['ts'], 'type' => $r['type'], 'message' => $r['message']], $stmt->fetchAll());
}
