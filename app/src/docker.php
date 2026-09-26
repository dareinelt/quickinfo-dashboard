<?php
declare(strict_types=1);

/**
 * Docker-Host-Unterstützung: aggregiert Container über mehrere quickinfo-Nodes
 * (Docker-Hosts) hinweg und liefert Live-Details eines Containers inkl. der
 * Zuordnung zu seinem Host – angelehnt an vSphere / Proxmox.
 */

require_once __DIR__ . '/nodes.php';

/**
 * Aggregierte Container-Liste über alle aktiven Nodes (unabhängig vom Host).
 * Jeder Container erhält eine Referenz auf seinen Host (Node).
 *
 * @return array{containers:array, hosts:array, groups:array, totals:array}
 */
function qb_docker_containers_aggregate(): array
{
    $rows = qb_db()->query(
        'SELECT c.*, n.name AS node_name, n.hostname AS node_hostname, n.url AS node_url, n.status AS node_status,
                n.sort_order AS node_sort, gi.group_id AS group_id
           FROM node_containers c
           JOIN nodes n ON n.id = c.node_id
           LEFT JOIN container_group_items gi ON gi.node_id = c.node_id AND gi.container_id = c.container_id
          WHERE n.enabled = 1
          ORDER BY n.sort_order, n.name, c.name'
    )->fetchAll();

    $containers = [];
    $hostStats = [];
    foreach ($rows as $r) {
        $ports = $r['ports'] !== null && $r['ports'] !== '' ? json_decode((string)$r['ports'], true) : null;
        $nodeId = (int)$r['node_id'];
        $containers[] = [
            'id'           => $nodeId . ':' . $r['container_id'],
            'node_id'      => $nodeId,
            'container_id' => $r['container_id'],
            'name'         => $r['name'],
            'image'        => $r['image'],
            'state'        => $r['state'],
            'status'       => $r['status'],
            'ports'        => $ports,
            'group_id'     => $r['group_id'] !== null ? (int)$r['group_id'] : null,
            'updated_at'   => (int)$r['updated_at'],
            'host'         => [
                'id'       => $nodeId,
                'name'     => $r['node_name'],
                'hostname' => $r['node_hostname'],
                'url'      => $r['node_url'],
                'status'   => $r['node_status'],
            ],
        ];

        if (!isset($hostStats[$nodeId])) {
            $hostStats[$nodeId] = [
                'id'              => $nodeId,
                'name'            => $r['node_name'],
                'hostname'        => $r['node_hostname'],
                'url'             => $r['node_url'],
                'status'          => $r['node_status'],
                'container_count' => 0,
                'running'         => 0,
            ];
        }
        $hostStats[$nodeId]['container_count']++;
        if ($r['state'] === 'running') {
            $hostStats[$nodeId]['running']++;
        }
    }

    $hosts = array_values($hostStats);
    $running = 0;
    foreach ($containers as $c) {
        if ($c['state'] === 'running') {
            $running++;
        }
    }

    return [
        'containers' => $containers,
        'hosts'      => $hosts,
        'groups'     => qb_container_groups_list(),
        'totals'     => [
            'hosts'      => count($hosts),
            'containers' => count($containers),
            'running'    => $running,
            'stopped'    => count($containers) - $running,
        ],
    ];
}

/** Anzahl der Nodes, die aktuell als Docker-Host Container liefern. */
function qb_docker_host_count(): int
{
    return (int)qb_db()->query(
        'SELECT COUNT(DISTINCT c.node_id)
           FROM node_containers c
           JOIN nodes n ON n.id = c.node_id
          WHERE n.enabled = 1'
    )->fetchColumn();
}

/**
 * Liefert Live-Detail + Auslastung eines Containers einer Node.
 * Die Host-Zuordnung (Node) wird immer mitgeliefert.
 */
function qb_docker_container_detail(int $nodeId, string $containerId): array
{
    $node = qb_node_row($nodeId) ?? qb_json_error('Node nicht gefunden.', 404);

    $stmt = qb_db()->prepare('SELECT * FROM node_containers WHERE node_id = ? AND container_id = ?');
    $stmt->execute([$nodeId, $containerId]);
    $row = $stmt->fetch();
    $name = $row ? (string)$row['name'] : '';
    if ($name === '') {
        qb_json_error('Container nicht gefunden.', 404);
    }

    $client = qb_node_client($node);
    if ($client === null) {
        qb_json_error('API-Schlüssel der Node kann nicht entschlüsselt werden.', 500);
    }

    $detail = $client->dockerContainer($name);
    $stats = $client->dockerStats($name);

    return [
        'id'           => $nodeId . ':' . $containerId,
        'node_id'      => $nodeId,
        'container_id' => $containerId,
        'name'         => $name,
        'image'        => $row['image'] ?? null,
        'state'        => $row['state'] ?? null,
        'status'       => $row['status'] ?? null,
        'updated_at'   => (int)($row['updated_at'] ?? 0),
        'host'         => [
            'id'       => $nodeId,
            'name'     => $node['name'],
            'hostname' => $node['hostname'],
            'url'      => $node['url'],
            'status'   => $node['status'],
        ],
        'detail'       => $detail['ok'] ? $detail['data'] : null,
        'detail_error' => $detail['ok'] ? null : $detail['error'],
        'stats'        => $stats['ok'] ? $stats['data'] : null,
        'stats_error'  => $stats['ok'] ? null : $stats['error'],
    ];
}

/**
 * Steuert einen Container (start|stop|restart) auf seiner Node.
 */
function qb_docker_container_action(int $nodeId, string $containerId, string $action): array
{
    if (!in_array($action, ['start', 'stop', 'restart'], true)) {
        qb_json_error('Ungültige Aktion. Erlaubt: start, stop, restart.', 400);
    }
    $node = qb_node_row($nodeId) ?? qb_json_error('Node nicht gefunden.', 404);

    $stmt = qb_db()->prepare('SELECT name FROM node_containers WHERE node_id = ? AND container_id = ?');
    $stmt->execute([$nodeId, $containerId]);
    $name = (string)$stmt->fetchColumn();
    if ($name === '') {
        qb_json_error('Container nicht gefunden.', 404);
    }

    $client = qb_node_client($node);
    if ($client === null) {
        qb_json_error('API-Schlüssel der Node kann nicht entschlüsselt werden.', 500);
    }

    $res = $client->dockerAction($name, $action);
    return ['ok' => $res['ok'], 'error' => $res['error'], 'action' => $action];
}

/**
 * Liefert die benutzerdefinierten Container-Ordner inkl. Anzahl zugeordneter Container.
 * @return list<array{id:int,name:string,sort_order:int,container_count:int}>
 */
function qb_container_groups_list(): array
{
    $rows = qb_db()->query('SELECT id, name, sort_order FROM container_groups ORDER BY sort_order, name')->fetchAll();
    return array_map(static function (array $r): array {
        $id = (int)$r['id'];
        return [
            'id'              => $id,
            'name'            => $r['name'],
            'sort_order'      => (int)$r['sort_order'],
            'container_count' => qb_container_group_count($id),
        ];
    }, $rows);
}

/** @return array{id:int,name:string,sort_order:int}|null */
function qb_container_group_row(int $id): ?array
{
    $stmt = qb_db()->prepare('SELECT id, name, sort_order FROM container_groups WHERE id = ?');
    $stmt->execute([$id]);
    $r = $stmt->fetch();
    return $r ? ['id' => (int)$r['id'], 'name' => $r['name'], 'sort_order' => (int)$r['sort_order']] : null;
}

function qb_container_group_count(int $id): int
{
    $stmt = qb_db()->prepare('SELECT COUNT(*) FROM container_group_items WHERE group_id = ?');
    $stmt->execute([$id]);
    return (int)$stmt->fetchColumn();
}

function qb_container_group_create(string $name): array
{
    $db = qb_db();
    try {
        $db->prepare('INSERT INTO container_groups (name, sort_order, created_at) VALUES (?, 0, ?)')
            ->execute([$name, time()]);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') {
            qb_json_error('Ein Ordner mit diesem Namen existiert bereits.', 409);
        }
        throw $e;
    }
    return ['id' => (int)$db->lastInsertId(), 'name' => $name, 'container_count' => 0];
}

function qb_container_group_rename(int $id, string $name): array
{
    if (qb_container_group_row($id) === null) {
        qb_json_error('Ordner nicht gefunden.', 404);
    }
    try {
        qb_db()->prepare('UPDATE container_groups SET name = ? WHERE id = ?')->execute([$name, $id]);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') {
            qb_json_error('Ein Ordner mit diesem Namen existiert bereits.', 409);
        }
        throw $e;
    }
    return ['id' => $id, 'name' => $name, 'container_count' => qb_container_group_count($id)];
}

function qb_container_group_delete(int $id): void
{
    if (qb_container_group_row($id) === null) {
        qb_json_error('Ordner nicht gefunden.', 404);
    }
    qb_db()->prepare('DELETE FROM container_groups WHERE id = ?')->execute([$id]);
}

/**
 * Weist einen Container einem Ordner zu (group_id) oder entfernt ihn aus Ordnern (group_id = null).
 * Die Zuordnung ist getrennt vom flüchtigen node_containers-Cache und bleibt über Polls erhalten.
 */
function qb_container_group_assign(int $nodeId, string $containerId, ?int $groupId): array
{
    $db = qb_db();
    $stmt = $db->prepare('SELECT 1 FROM node_containers WHERE node_id = ? AND container_id = ?');
    $stmt->execute([$nodeId, $containerId]);
    if (!$stmt->fetchColumn()) {
        qb_json_error('Container nicht gefunden.', 404);
    }

    if ($groupId === null) {
        $db->prepare('DELETE FROM container_group_items WHERE node_id = ? AND container_id = ?')
            ->execute([$nodeId, $containerId]);
    } else {
        if (qb_container_group_row($groupId) === null) {
            qb_json_error('Ordner nicht gefunden.', 404);
        }
        $db->prepare(
            'INSERT INTO container_group_items (node_id, container_id, group_id) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE group_id = VALUES(group_id)'
        )->execute([$nodeId, $containerId, $groupId]);
    }
    return ['ok' => true, 'group_id' => $groupId];
}
