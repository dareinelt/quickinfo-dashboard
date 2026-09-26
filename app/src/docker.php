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
 * @return array{containers:array, hosts:array, totals:array}
 */
function qb_docker_containers_aggregate(): array
{
    $rows = qb_db()->query(
        'SELECT c.*, n.name AS node_name, n.hostname AS node_hostname, n.url AS node_url, n.status AS node_status,
                n.sort_order AS node_sort
           FROM node_containers c
           JOIN nodes n ON n.id = c.node_id
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
