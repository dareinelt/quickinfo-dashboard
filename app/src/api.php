<?php
declare(strict_types=1);

/**
 * REST-API des Management-Boards (Session-basiert, JSON).
 *
 *  GET    /api/session                 Login-Status, CSRF-Token
 *  POST   /api/login                   {username, password}
 *  POST   /api/logout
 *  POST   /api/password                {current, new}
 *  GET    /api/overview                Alle Nodes mit Kurzstatus (Grid)
 *  GET    /api/nodes                   Alle Nodes (Verwaltung)
 *  POST   /api/nodes                   Node anlegen (mit Verbindungstest)
 *  POST   /api/nodes/test              Verbindungstest ohne Speichern {url, api_key, verify_tls[, id]}
 *  GET    /api/nodes/{id}              Detailansicht (Snapshot, Info, Dienste, Ereignisse)
 *  PUT    /api/nodes/{id}              Node bearbeiten
 *  DELETE /api/nodes/{id}              Node löschen
 *  POST   /api/nodes/{id}/poll         Node sofort abfragen
 *  GET    /api/nodes/{id}/history      ?range=1h|3h|24h|3d|14d[&metrics=a,b]
 */

require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/nodes.php';
require_once __DIR__ . '/collector.php';
require_once __DIR__ . '/history.php';

function qb_api_dispatch(): never
{
    $method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
    $path = parse_url((string)($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?: '/';
    $path = preg_replace('~^/api/?~', '', $path) ?? '';
    $path = trim($path, '/');
    $seg = $path === '' ? [] : explode('/', $path);

    qb_session_start();
    qb_ensure_admin_user();

    // Schreibende Anfragen benötigen CSRF-Token (außer Login)
    if (!in_array($method, ['GET', 'HEAD'], true) && $path !== 'login') {
        qb_require_auth();
        qb_require_csrf();
    }

    switch (true) {
        case $path === 'session' && $method === 'GET':
            $user = qb_current_user();
            qb_json_response([
                'authenticated' => $user !== null,
                'user'          => $user ? ['username' => $user['username'], 'last_login' => $user['last_login'] ? (int)$user['last_login'] : null] : null,
                'csrf'          => $_SESSION['csrf'],
                'version'       => QB_VERSION,
                'interval'      => qb_config()['collector']['interval'],
                'ranges'        => array_keys(QB_RANGES),
            ]);

        case $path === 'login' && $method === 'POST':
            $in = qb_request_json();
            $user = qb_login(trim((string)($in['username'] ?? '')), (string)($in['password'] ?? ''));
            qb_json_response(['ok' => true, 'user' => $user, 'csrf' => $_SESSION['csrf']]);

        case $path === 'logout' && $method === 'POST':
            qb_logout();
            qb_json_response(['ok' => true]);

        case $path === 'password' && $method === 'POST':
            $user = qb_require_auth();
            $in = qb_request_json();
            qb_change_password((int)$user['id'], (string)($in['current'] ?? ''), (string)($in['new'] ?? ''));
            qb_json_response(['ok' => true]);

        case $path === 'overview' && $method === 'GET':
            qb_require_auth();
            $nodes = qb_nodes_list();
            qb_json_response([
                'now'      => time(),
                'interval' => qb_config()['collector']['interval'],
                'collector_alive' => qb_collector_alive(),
                'nodes'    => $nodes,
                'totals'   => qb_totals($nodes),
            ]);

        case $path === 'nodes' && $method === 'GET':
            qb_require_auth();
            qb_json_response(['nodes' => qb_nodes_list()]);

        case $path === 'nodes' && $method === 'POST':
            $in = qb_request_json();
            $v = qb_node_validate($in, true);
            $test = qb_node_test($v['url'], (string)$v['api_key'], (bool)$v['verify_tls']);
            if (!$test['ok'] && empty($in['force'])) {
                qb_json_error('Verbindungstest fehlgeschlagen: ' . $test['error'], 422, ['test' => $test, 'field' => 'url']);
            }
            $id = qb_node_create($v, $test);
            qb_json_response(['ok' => true, 'node' => qb_node_present(qb_node_row($id), true), 'test' => $test], 201);

        case $path === 'nodes/test' && $method === 'POST':
            $in = qb_request_json();
            $v = qb_node_validate($in, false);
            $key = $v['api_key'];
            if ($key === null && !empty($in['id'])) {
                // Test einer bestehenden Node mit dem gespeicherten Schlüssel
                $row = qb_node_row((int)$in['id']);
                $key = $row ? qb_node_api_key($row) : null;
            }
            if ($key === null) {
                qb_json_error('Bitte den API-Schlüssel angeben.', 422, ['field' => 'api_key']);
            }
            qb_json_response(qb_node_test($v['url'], $key, (bool)$v['verify_tls']));

        case count($seg) === 2 && $seg[0] === 'nodes' && ctype_digit($seg[1]):
            $node = qb_node_row((int)$seg[1]) ?? qb_json_error('Node nicht gefunden.', 404);
            if ($method === 'GET') {
                qb_require_auth();
                $out = qb_node_present($node, true);
                $out['events'] = qb_node_events((int)$node['id']);
                $out['collector_alive'] = qb_collector_alive();
                qb_json_response($out);
            }
            if ($method === 'PUT') {
                $v = qb_node_validate(qb_request_json(), false);
                qb_node_update((int)$node['id'], $v);
                qb_json_response(['ok' => true, 'node' => qb_node_present(qb_node_row((int)$node['id']), true)]);
            }
            if ($method === 'DELETE') {
                qb_node_delete((int)$node['id']);
                qb_json_response(['ok' => true]);
            }
            break;

        case count($seg) === 3 && $seg[0] === 'nodes' && ctype_digit($seg[1]) && $seg[2] === 'poll' && $method === 'POST':
            $node = qb_node_row((int)$seg[1]) ?? qb_json_error('Node nicht gefunden.', 404);
            $r = qb_collector_poll_node($node);
            qb_json_response(['ok' => $r['ok'], 'error' => $r['error'], 'ms' => $r['ms'], 'node' => qb_node_present(qb_node_row((int)$node['id']), true)]);

        case count($seg) === 3 && $seg[0] === 'nodes' && ctype_digit($seg[1]) && $seg[2] === 'history' && $method === 'GET':
            qb_require_auth();
            $node = qb_node_row((int)$seg[1]) ?? qb_json_error('Node nicht gefunden.', 404);
            $range = (string)($_GET['range'] ?? '1h');
            if (!isset(QB_RANGES[$range])) {
                qb_json_error('Ungültiger Zeitraum. Erlaubt: ' . implode(', ', array_keys(QB_RANGES)), 400);
            }
            $filter = trim((string)($_GET['metrics'] ?? ''));
            $metrics = $filter !== '' ? array_values(array_filter(array_map('trim', explode(',', $filter)))) : null;
            $data = qb_history_build((int)$node['id'], $range, $metrics);
            $data['node_id'] = (int)$node['id'];
            qb_json_response($data);
    }

    qb_json_error('Endpunkt nicht gefunden.', 404);
}

function qb_collector_alive(): bool
{
    $last = qb_db()->query('SELECT MAX(last_poll) FROM nodes WHERE enabled = 1')->fetchColumn();
    if ($last === false || $last === null) {
        // Ohne Nodes: Lebenszeichen über die Wartung
        $m = (int)qb_meta_get('collector_heartbeat', '0');
        return $m > 0 && time() - $m < 3 * qb_config()['collector']['interval'] + 30;
    }
    return time() - (int)$last < 3 * qb_config()['collector']['interval'] + 30;
}

function qb_totals(array $nodes): array
{
    $t = ['nodes' => count($nodes), 'online' => 0, 'offline' => 0, 'disabled' => 0, 'unknown' => 0, 'services_down' => 0, 'warnings' => 0];
    foreach ($nodes as $n) {
        $t[$n['status']] = ($t[$n['status']] ?? 0) + 1;
        $t['services_down'] += (int)$n['summary']['services_down'];
        $s = $n['summary'];
        // Schwellenwerte identisch zum Frontend (Gelb-Stufe): CPU/GPU 75 %, RAM/Disk 80 %, CPU-Temp 70 °C, GPU-Temp 75 °C
        if ($n['status'] === 'online' && (
            ($s['cpu'] !== null && $s['cpu'] >= 75) || ($s['gpu'] !== null && $s['gpu'] >= 75)
            || ($s['mem_pct'] !== null && $s['mem_pct'] >= 80) || ($s['disk_pct'] !== null && $s['disk_pct'] >= 80)
            || ($s['temp'] !== null && $s['temp'] >= 70) || ($s['gpu_temp'] !== null && $s['gpu_temp'] >= 75)
            || $s['services_down'] > 0)) {
            $t['warnings']++;
        }
    }
    return $t;
}
