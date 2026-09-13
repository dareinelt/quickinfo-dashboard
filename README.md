# quickinfo Board – zentrales Management-Dashboard

Ein modernes, komplett offline-fähiges Management-Board, das mehrere Bare-Metal-Server
überwacht, auf denen [quickinfo](https://github.com/dareinelt/quickinfo) läuft. Das Board
sammelt über die quickinfo REST-API (`/api/v1/*`) zyklisch Messwerte aller Nodes, speichert
sie lokal in MariaDB und visualisiert sie in einem Dark-Theme-Dashboard.

- **Stack:** PHP 8.3 (nativ, keine Frameworks), MariaDB 11, Nginx, Vanilla JS (ES2020+), HTML5, CSS3
- **0 % externe Abhängigkeiten:** keine CDNs, keine Fonts, keine Icon- oder Chart-Bibliotheken – alles
  läuft vollständig isoliert ohne Internetverbindung
- **Charts:** Retina-taugliches HTML5 Canvas (eigene Engine in `app/public/assets/chart.js`)
- **Deployment:** `docker compose up -d` – fertig

---

## Funktionen

| Bereich | Details |
|---|---|
| **Übersichts-Grid** | Kachel je Server: Online/Offline, Uptime, CPU, Temperatur, GPU bzw. RAM, freier Speicherplatz auf `/`, Dienststatus. Farbindikatoren Grün/Gelb/Rot bei Schwellenwerten (CPU ≥ 75/90 %, Temp ≥ 70/80 °C, Disk/RAM ≥ 80/90 %) |
| **Detail-Ansicht** | KPIs, Verlaufsgraphen für **1h · 3h · 24h · 3d · 14d** (CPU, Temperaturen inkl. aller Sensoren, RAM/Disk, Load, GPU, alle CPU-Kerne, Erreichbarkeit), aktuelle Kern-Auslastung, GPU-Details, systemd-Dienste mit 24h-Verfügbarkeit, Ereignisprotokoll (Offline/Online, Dienstausfälle) |
| **Node-Verwaltung** | Server hinzufügen/bearbeiten/löschen mit **Name, IP/Hostname, API-Schlüssel**. Sofortiger Verbindungstest (Pairing) beim Speichern, „Jetzt abfragen“ |
| **Collector** | PHP-CLI-Daemon im eigenen Container, pollt alle Nodes im Intervall (`COLLECTOR_INTERVAL`, Standard 60 s), Sofort-Retry bei Netzwerkfehlern, Offline erst nach 2 Fehlversuchen in Folge, stündliche Verdichtung in 10-Minuten-Buckets und Retention |
| **Sicherheit** | Passwort-Login (bcrypt), Session + CSRF-Token, Brute-Force-Sperre, API-Keys der Nodes **AES-256-GCM-verschlüsselt** in der DB (Schlüssel aus `APP_SECRET`), strikte CSP, einzige PHP-Datei im Webroot |

---

## Schnellstart

```bash
git clone https://github.com/dareinelt/quickinfo-dashboard.git
cd quickinfo-dashboard

# optional, aber empfohlen: Passwörter & Secret setzen
cp .env.example .env
sed -i "s/^APP_SECRET=.*/APP_SECRET=$(openssl rand -hex 32)/" .env

docker compose up -d
```

Anschließend im Browser öffnen: **http://localhost:8080** (Port über `HTTP_PORT` änderbar).

Standard-Login: **admin / admin** (über `ADMIN_USER` / `ADMIN_PASSWORD` in `.env` setzbar; der Benutzer
wird nur beim allerersten Start angelegt). Das Passwort bitte direkt unter *Einstellungen* ändern.

Beim ersten Start legt MariaDB das Schema aus `docker/db/init.sql` automatisch an. Das Board ist
danach sofort einsatzbereit – es müssen keine weiteren Befehle ausgeführt werden.

### Container

| Container | Aufgabe |
|---|---|
| `qiboard-web` | Nginx – statisches Frontend + FastCGI-Proxy für `/api/` |
| `qiboard-php` | PHP-FPM – REST-API des Boards |
| `qiboard-collector` | PHP-CLI-Daemon – pollt die Nodes, schreibt Metriken, Aggregation/Retention |
| `qiboard-db` | MariaDB 11 – persistente Daten im Volume `db-data` |

```bash
docker compose logs -f collector     # Collector-Ausgabe (jede Abfrage wird protokolliert)
docker compose exec collector php /var/www/app/bin/collector.php --verbose        # einmaliger Lauf
docker compose exec collector php /var/www/app/bin/collector.php --maintenance    # Aggregation/Retention manuell
docker compose down                  # stoppen (Daten bleiben im Volume erhalten)
docker compose down -v               # stoppen und alle Daten löschen
```

---

## Eine quickinfo-Instanz koppeln

1. **API-Schlüssel auf dem Zielserver erzeugen**
   In der quickinfo-Oberfläche unter *Einstellungen → API & Management-Board* einen Schlüssel erzeugen
   (der Klartext wird nur einmal angezeigt). Alternativ per CLI auf dem Server:
   ```bash
   php /var/www/html/quickinfo/bin/apikey.php rotate
   ```
2. **Im Board hinzufügen**
   *Server → Server hinzufügen* (oder der Button in der Übersicht) und eintragen:
   - **Name / Label**, z.B. „Webserver Alpha“
   - **IP-Adresse oder Hostname**, z.B. `192.168.1.10` oder `https://srv01.local:8443`
     (ohne Schema wird `https://` angenommen – quickinfo installiert standardmäßig mit HTTPS)
   - **API-Schlüssel** (Bearer Token)
   - *TLS-Zertifikat prüfen* nur aktivieren, wenn die Node ein gültiges (nicht selbstsigniertes) Zertifikat hat
3. **Verbinden & speichern** – das Board ruft sofort `/api/v1/info` und `/api/v1/status` ab.
   Schlägt der Test fehl, wird die Fehlerursache angezeigt (Timeout, ungültiger Schlüssel, kein quickinfo …).
   Die Node kann optional trotzdem gespeichert werden und gilt bis zum ersten erfolgreichen Poll als offline.

Ab dem nächsten Collector-Durchlauf (≤ `COLLECTOR_INTERVAL` Sekunden) erscheinen die Werte im Grid;
Verlaufsgraphen füllen sich mit der Zeit aus der lokalen Historie des Boards.

> Hinweis: Nach einer Schlüssel-Rotation auf der Node wird der alte Schlüssel sofort ungültig. Im Board die
> Node bearbeiten und den neuen Schlüssel eintragen.

---

## Konfiguration (`.env`)

| Variable | Standard | Beschreibung |
|---|---|---|
| `HTTP_PORT` | `8080` | Host-Port des Boards |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` / `DB_ROOT_PASSWORD` | `qiboard` / `qiboard` / … | MariaDB-Zugang |
| `APP_SECRET` | *(Platzhalter)* | Schlüsselmaterial für die Verschlüsselung der Node-API-Keys. **Unbedingt ändern.** Bei späterer Änderung sind gespeicherte Keys nicht mehr lesbar (Nodes neu koppeln). |
| `ADMIN_USER` / `ADMIN_PASSWORD` | `admin` / `admin` | Erster Benutzer (nur beim ersten Start) |
| `SESSION_LIFETIME` | `43200` | Session-Laufzeit in Sekunden |
| `COLLECTOR_INTERVAL` | `60` | Abfrageintervall in Sekunden (30–60 empfohlen) |
| `COLLECTOR_TIMEOUT` | `10` | HTTP-Timeout pro Node in Sekunden |
| `RETENTION_RAW_DAYS` | `4` | Aufbewahrung der Rohdaten (ein Punkt pro Poll) |
| `RETENTION_AGG_DAYS` | `30` | Aufbewahrung der 10-Minuten-Aggregate |
| `TZ` | `Europe/Berlin` | Zeitzone |

---

## Projektstruktur

```
docker-compose.yml            Nginx + PHP-FPM + Collector + MariaDB
.env.example                  Konfigurationsvorlage
docker/
  nginx/default.conf          Webserver-Konfiguration (CSP, FastCGI, SPA-Fallback)
  php/Dockerfile, php.ini     PHP 8.3 FPM (Alpine) mit pdo_mysql
  db/init.sql                 Datenbankschema (automatisch beim ersten Start)
app/
  public/
    index.html                SPA-Einstieg
    api/index.php             einzige PHP-Datei im Webroot (API-Router)
    assets/style.css          Dark-Theme (System-Schriften)
    assets/chart.js           Canvas-Chart-Engine (Retina, Tooltips, Gaps, Schwellenwerte)
    assets/app.js             Frontend-Anwendung (Router, Views, Node-Verwaltung)
  src/
    bootstrap.php             Konfiguration, DB, Hilfsfunktionen
    crypto.php                AES-256-GCM für API-Keys
    quickinfo_client.php      HTTP-Client für /api/v1/*
    auth.php                  Login, Session, CSRF, Brute-Force-Schutz
    nodes.php                 Node-CRUD, Verbindungstest, Ausgabeformat
    collector.php             Polling, Metrik-Extraktion, Ereignisse, Aggregation, Retention
    history.php               Zeitreihen (Rohdaten + Aggregate) für 1h…14d
    api.php                   REST-Endpunkte
  bin/collector.php           CLI: einmalig, --daemon, --maintenance
```

## REST-API des Boards

| Methode | Pfad | Beschreibung |
|---|---|---|
| GET | `/api/session` | Login-Status, CSRF-Token |
| POST | `/api/login` · `/api/logout` · `/api/password` | Authentifizierung |
| GET | `/api/overview` | Alle Nodes mit Kurzstatus, Summen, Collector-Zustand |
| GET/POST | `/api/nodes` | Nodes auflisten / anlegen (mit Verbindungstest, `force: true` überspringt) |
| POST | `/api/nodes/test` | Verbindungstest ohne Speichern |
| GET/PUT/DELETE | `/api/nodes/{id}` | Detail / bearbeiten / löschen |
| POST | `/api/nodes/{id}/poll` | Node sofort abfragen |
| GET | `/api/nodes/{id}/history?range=1h\|3h\|24h\|3d\|14d[&metrics=cpu.total,temp.max]` | Zeitreihen `{metric: [[ts, value], …]}` |

Schreibende Anfragen benötigen den Header `X-CSRF-Token` (aus `/api/session`).

## Datenhaltung

- `node_metrics`: ein Messpunkt pro Poll und Metrik (`cpu.total`, `cpu.core.N`, `temp.max`, `temp.*`,
  `mem.used_pct`, `disk.used_pct`, `load.1/5/15`, `gpu.N.util/temp/mem_pct/power`, `services.down`, `online`)
- `node_metrics_agg`: 10-Minuten-Buckets (avg/min/max), stündlich vom Collector erzeugt
- Zeiträume 1h/3h nutzen Rohdaten (60-s-Raster), 24h ein 5-Minuten-Raster, 3d/14d greifen auf die Aggregate zurück

## Troubleshooting

- **„Collector inaktiv“ in der Kopfzeile:** `docker compose logs collector` prüfen; der Container muss laufen.
- **Node offline, Fehler „Zeitüberschreitung“:** Firewall/Port der Node prüfen; das Board muss die Node aus dem
  Docker-Netz erreichen (bei lokalen Tests ggf. `host.docker.internal` verwenden).
- **„API-Schlüssel ungültig (401)“:** Schlüssel wurde rotiert oder falsch kopiert – Node bearbeiten.
- **„API-Schlüssel kann nicht entschlüsselt werden“:** `APP_SECRET` wurde nach dem Speichern geändert – Node neu koppeln.
