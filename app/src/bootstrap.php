<?php
declare(strict_types=1);

/**
 * quickinfo Management-Board – Bootstrap: Konfiguration, Datenbank, Hilfsfunktionen.
 */

const QB_VERSION = '1.0.0';

const QB_RANGES = [
    '1h'  => ['seconds' => 3600,       'step' => 60],
    '3h'  => ['seconds' => 3 * 3600,   'step' => 60],
    '24h' => ['seconds' => 24 * 3600,  'step' => 300],
    '3d'  => ['seconds' => 3 * 86400,  'step' => 600],
    '14d' => ['seconds' => 14 * 86400, 'step' => 3600],
];

const QB_AGG_BUCKET = 600;

function qb_env(string $key, string $default = ''): string
{
    $v = getenv($key);
    if ($v === false || $v === '') {
        return $default;
    }
    return $v;
}

function qb_config(): array
{
    static $cfg = null;
    if ($cfg === null) {
        $cfg = [
            'db' => [
                'host' => qb_env('DB_HOST', 'db'),
                'port' => (int)qb_env('DB_PORT', '3306'),
                'name' => qb_env('DB_NAME', 'qiboard'),
                'user' => qb_env('DB_USER', 'qiboard'),
                'pass' => qb_env('DB_PASSWORD', ''),
            ],
            'app_secret'       => qb_env('APP_SECRET', 'change-me-app-secret-please'),
            'admin_user'       => qb_env('ADMIN_USER', 'admin'),
            'admin_password'   => qb_env('ADMIN_PASSWORD', 'admin'),
            'session_lifetime' => max(300, (int)qb_env('SESSION_LIFETIME', '43200')),
            'collector' => [
                'interval' => max(10, (int)qb_env('COLLECTOR_INTERVAL', '60')),
                'timeout'  => max(2, (int)qb_env('COLLECTOR_TIMEOUT', '10')),
            ],
            'retention' => [
                'raw_days' => max(1, (int)qb_env('RETENTION_RAW_DAYS', '4')),
                'agg_days' => max(1, (int)qb_env('RETENTION_AGG_DAYS', '30')),
            ],
        ];
    }
    return $cfg;
}

function qb_db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }
    $c = qb_config()['db'];
    $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $c['host'], $c['port'], $c['name']);
    $lastError = null;
    // Beim Container-Start kann die DB noch nicht bereit sein – kurz warten.
    for ($i = 0; $i < 30; $i++) {
        try {
            $pdo = new PDO($dsn, $c['user'], $c['pass'], [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
                PDO::ATTR_TIMEOUT            => 5,
            ]);
            qb_schema_migrate($pdo);
            return $pdo;
        } catch (PDOException $e) {
            $lastError = $e;
            if (PHP_SAPI !== 'cli') {
                break;
            }
            sleep(2);
        }
    }
    throw new RuntimeException('Datenbankverbindung fehlgeschlagen: ' . ($lastError?->getMessage() ?? 'unbekannt'));
}

/**
 * Idempotente Schema-Migration für Bestandsinstallationen.
 * Neue Tabellen werden ergänzt, ohne das bestehende Schema zu berühren
 * (frische Installationen erhalten die Tabellen weiterhin über docker/db/init.sql).
 */
function qb_schema_migrate(PDO $db): void
{
    $db->exec(
        'CREATE TABLE IF NOT EXISTS node_containers (
            node_id       INT UNSIGNED NOT NULL,
            container_id  VARCHAR(64)  NOT NULL,
            name          VARCHAR(255) NOT NULL,
            image         VARCHAR(255) NULL,
            state         VARCHAR(32)  NULL,
            status        VARCHAR(255) NULL,
            ports         TEXT         NULL,
            updated_at    INT UNSIGNED NOT NULL,
            PRIMARY KEY (node_id, container_id),
            KEY idx_node_containers_node (node_id),
            CONSTRAINT fk_node_containers_node FOREIGN KEY (node_id)
                REFERENCES nodes (id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
    );
}

function qb_meta_get(string $key, ?string $default = null): ?string
{
    $stmt = qb_db()->prepare('SELECT v FROM meta WHERE k = ?');
    $stmt->execute([$key]);
    $v = $stmt->fetchColumn();
    return $v === false ? $default : (string)$v;
}

function qb_meta_set(string $key, string $value): void
{
    $stmt = qb_db()->prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON DUPLICATE KEY UPDATE v = VALUES(v)');
    $stmt->execute([$key, $value]);
}

function qb_log(string $msg): void
{
    $line = sprintf("[%s] %s\n", date('Y-m-d H:i:s'), $msg);
    if (PHP_SAPI === 'cli') {
        fwrite(STDOUT, $line);
    } else {
        error_log(trim($line));
    }
}

function qb_json_response(mixed $data, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION);
    exit;
}

function qb_json_error(string $message, int $status = 400, array $extra = []): never
{
    qb_json_response(['error' => $message] + $extra, $status);
}

function qb_request_json(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        return [];
    }
    $data = json_decode($raw, true);
    if (!is_array($data)) {
        qb_json_error('Ungültiger JSON-Body.', 400);
    }
    return $data;
}

function qb_client_ip(): string
{
    return substr((string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'), 0, 45);
}

/**
 * Normalisiert eine Benutzereingabe (IP, Hostname oder URL) zu einer Basis-URL.
 * Ohne Schema wird https:// angenommen (quickinfo installiert standardmäßig mit Self-Signed-TLS).
 */
function qb_normalize_url(string $input): ?string
{
    $input = trim($input);
    if ($input === '') {
        return null;
    }
    if (!preg_match('~^[a-z][a-z0-9+.-]*://~i', $input)) {
        $input = 'https://' . $input;
    }
    $parts = parse_url($input);
    if ($parts === false || empty($parts['host']) || !in_array(strtolower($parts['scheme'] ?? ''), ['http', 'https'], true)) {
        return null;
    }
    $url = strtolower($parts['scheme']) . '://' . $parts['host'];
    if (!empty($parts['port'])) {
        $url .= ':' . (int)$parts['port'];
    }
    $path = rtrim((string)($parts['path'] ?? ''), '/');
    // Ein evtl. mitkopierter /api/v1-Pfad wird entfernt
    $path = preg_replace('~/api(/v1)?$~', '', $path) ?? $path;
    return $url . $path;
}

require_once __DIR__ . '/crypto.php';
require_once __DIR__ . '/quickinfo_client.php';
