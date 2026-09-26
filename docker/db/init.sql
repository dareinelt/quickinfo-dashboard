-- quickinfo Management-Board – Datenbankschema
-- Wird beim ersten Start des MariaDB-Containers automatisch eingespielt.

SET NAMES utf8mb4;

-- Benutzer des Management-Boards
CREATE TABLE IF NOT EXISTS users (
    id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
    username       VARCHAR(64)  NOT NULL,
    password_hash  VARCHAR(255) NOT NULL,
    created_at     INT UNSIGNED NOT NULL,
    last_login     INT UNSIGNED NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Brute-Force-Schutz für den Login
CREATE TABLE IF NOT EXISTS login_attempts (
    ip            VARCHAR(45)  NOT NULL,
    attempts      INT UNSIGNED NOT NULL DEFAULT 0,
    last_attempt  INT UNSIGNED NOT NULL,
    PRIMARY KEY (ip)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Überwachte Server (Nodes). Der API-Key wird AES-256-GCM-verschlüsselt abgelegt
-- (Schlüssel aus APP_SECRET abgeleitet); api_key_prefix dient nur der Wiedererkennung.
CREATE TABLE IF NOT EXISTS nodes (
    id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name                 VARCHAR(128) NOT NULL,
    url                  VARCHAR(255) NOT NULL,          -- Basis-URL, z.B. https://192.168.1.10
    api_key_enc          TEXT         NOT NULL,          -- base64(iv | tag | ciphertext)
    api_key_prefix       VARCHAR(16)  NOT NULL DEFAULT '',
    verify_tls           TINYINT(1)   NOT NULL DEFAULT 0,
    enabled              TINYINT(1)   NOT NULL DEFAULT 1,
    sort_order           INT          NOT NULL DEFAULT 0,
    status               ENUM('unknown','online','offline') NOT NULL DEFAULT 'unknown',
    consecutive_failures INT UNSIGNED NOT NULL DEFAULT 0,
    last_error           VARCHAR(512) NULL,
    last_poll            INT UNSIGNED NULL,              -- letzter Abfrageversuch
    last_seen            INT UNSIGNED NULL,              -- letzte erfolgreiche Abfrage
    hostname             VARCHAR(255) NULL,
    info_json            MEDIUMTEXT   NULL,              -- /api/v1/info (Metadaten)
    snapshot_json        MEDIUMTEXT   NULL,              -- letzter /api/v1/status
    snapshot_ts          INT UNSIGNED NULL,
    created_at           INT UNSIGNED NOT NULL,
    updated_at           INT UNSIGNED NOT NULL,
    PRIMARY KEY (id),
    KEY idx_nodes_enabled (enabled, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Rohdaten pro Node (ein Messpunkt pro Poll)
CREATE TABLE IF NOT EXISTS node_metrics (
    node_id  INT UNSIGNED NOT NULL,
    metric   VARCHAR(48)  NOT NULL,
    ts       INT UNSIGNED NOT NULL,
    value    DOUBLE       NOT NULL,
    PRIMARY KEY (node_id, metric, ts),
    KEY idx_node_metrics_ts (ts),
    CONSTRAINT fk_node_metrics_node FOREIGN KEY (node_id)
        REFERENCES nodes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Verdichtete Daten (10-Minuten-Buckets) für lange Zeiträume
CREATE TABLE IF NOT EXISTS node_metrics_agg (
    node_id    INT UNSIGNED NOT NULL,
    metric     VARCHAR(48)  NOT NULL,
    ts         INT UNSIGNED NOT NULL,          -- Bucket-Start
    avg_value  DOUBLE       NOT NULL,
    min_value  DOUBLE       NOT NULL,
    max_value  DOUBLE       NOT NULL,
    samples    SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    PRIMARY KEY (node_id, metric, ts),
    KEY idx_node_metrics_agg_ts (ts),
    CONSTRAINT fk_node_metrics_agg_node FOREIGN KEY (node_id)
        REFERENCES nodes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Aktueller Status der überwachten systemd-Dienste je Node
CREATE TABLE IF NOT EXISTS node_services (
    node_id       INT UNSIGNED NOT NULL,
    name          VARCHAR(128) NOT NULL,
    display_name  VARCHAR(128) NOT NULL,
    active        TINYINT(1)   NULL,
    state         VARCHAR(64)  NULL,
    uptime_24h    DOUBLE       NULL,
    last_check    INT UNSIGNED NULL,
    updated_at    INT UNSIGNED NOT NULL,
    PRIMARY KEY (node_id, name),
    CONSTRAINT fk_node_services_node FOREIGN KEY (node_id)
        REFERENCES nodes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Docker-Container je Node (aus /api/v1/docker/containers der jeweiligen quickinfo-Instanz)
CREATE TABLE IF NOT EXISTS node_containers (
    node_id       INT UNSIGNED NOT NULL,
    container_id  VARCHAR(64)  NOT NULL,
    name          VARCHAR(255) NOT NULL,
    image         VARCHAR(255) NULL,
    state         VARCHAR(32)  NULL,          -- running | exited | created | paused | …
    status        VARCHAR(255) NULL,
    ports         TEXT         NULL,
    updated_at    INT UNSIGNED NOT NULL,
    PRIMARY KEY (node_id, container_id),
    KEY idx_node_containers_node (node_id),
    CONSTRAINT fk_node_containers_node FOREIGN KEY (node_id)
        REFERENCES nodes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Verlauf von Online-/Offline-Wechseln und Dienstausfällen
CREATE TABLE IF NOT EXISTS node_events (
    id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    node_id  INT UNSIGNED NOT NULL,
    ts       INT UNSIGNED NOT NULL,
    type     VARCHAR(32)  NOT NULL,            -- online | offline | service_down | service_up
    message  VARCHAR(512) NOT NULL,
    PRIMARY KEY (id),
    KEY idx_node_events_node_ts (node_id, ts),
    CONSTRAINT fk_node_events_node FOREIGN KEY (node_id)
        REFERENCES nodes (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Interne Schlüssel/Werte (z.B. Zeitpunkt der letzten Aggregation)
CREATE TABLE IF NOT EXISTS meta (
    k  VARCHAR(64)  NOT NULL,
    v  VARCHAR(255) NOT NULL,
    PRIMARY KEY (k)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
