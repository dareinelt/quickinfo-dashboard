<?php
declare(strict_types=1);

/**
 * HTTP-Client für die quickinfo REST-API v1 (/api/v1/status, /info, /history).
 * Nutzt ausschließlich PHP-Streams – keine externen Abhängigkeiten.
 */

final class QuickinfoClient
{
    public function __construct(
        private readonly string $baseUrl,
        private readonly string $apiKey,
        private readonly bool $verifyTls = false,
        private readonly int $timeout = 10,
    ) {
    }

    /**
     * @return array{ok:bool, status:int, data:?array, error:?string, ms:int}
     */
    public function get(string $endpoint, array $query = []): array
    {
        $url = rtrim($this->baseUrl, '/') . '/api/v1/' . ltrim($endpoint, '/');
        if ($query) {
            $url .= '?' . http_build_query($query);
        }

        $ctx = stream_context_create([
            'http' => [
                'method'          => 'GET',
                'header'          => implode("\r\n", [
                    'Authorization: Bearer ' . $this->apiKey,
                    'Accept: application/json',
                    'User-Agent: quickinfo-board/' . QB_VERSION,
                    'Connection: close',
                ]),
                'timeout'         => $this->timeout,
                'ignore_errors'   => true,
                'follow_location' => 0,
            ],
            'ssl' => [
                'verify_peer'       => $this->verifyTls,
                'verify_peer_name'  => $this->verifyTls,
                'allow_self_signed' => !$this->verifyTls,
            ],
        ]);

        $start = microtime(true);
        $body = @file_get_contents($url, false, $ctx);
        $ms = (int)round((microtime(true) - $start) * 1000);
        $headers = $http_response_header ?? [];

        if ($body === false) {
            $err = error_get_last();
            $msg = $err ? preg_replace('~^file_get_contents\([^)]*\): ~', '', (string)$err['message']) : 'Verbindung fehlgeschlagen';
            return ['ok' => false, 'status' => 0, 'data' => null, 'error' => $this->humanizeError((string)$msg), 'ms' => $ms];
        }

        $status = 0;
        if (isset($headers[0]) && preg_match('~HTTP/\S+\s+(\d{3})~', $headers[0], $m)) {
            $status = (int)$m[1];
        }

        $data = json_decode($body, true);
        if ($status === 401 || $status === 403) {
            return ['ok' => false, 'status' => $status, 'data' => null,
                'error' => 'API-Schlüssel ungültig (' . $status . ')' . (is_array($data) && isset($data['error']) ? ': ' . $data['error'] : ''), 'ms' => $ms];
        }
        if ($status === 429) {
            return ['ok' => false, 'status' => $status, 'data' => null, 'error' => 'Rate-Limit der quickinfo-Instanz erreicht (429)', 'ms' => $ms];
        }
        if ($status < 200 || $status >= 300) {
            $hint = is_array($data) && isset($data['error']) ? ': ' . $data['error'] : '';
            if ($status === 404 && !is_array($data)) {
                $hint = ': /api/v1 nicht gefunden – läuft quickinfo unter dieser URL?';
            }
            return ['ok' => false, 'status' => $status, 'data' => null, 'error' => 'HTTP ' . $status . $hint, 'ms' => $ms];
        }
        if (!is_array($data)) {
            return ['ok' => false, 'status' => $status, 'data' => null, 'error' => 'Antwort ist kein gültiges JSON', 'ms' => $ms];
        }
        return ['ok' => true, 'status' => $status, 'data' => $data, 'error' => null, 'ms' => $ms];
    }

    public function status(): array
    {
        return $this->get('status');
    }

    public function info(): array
    {
        return $this->get('info');
    }

    private function humanizeError(string $msg): string
    {
        $lower = strtolower($msg);
        if (str_contains($lower, 'timed out') || str_contains($lower, 'timeout')) {
            return 'Zeitüberschreitung nach ' . $this->timeout . 's';
        }
        if (str_contains($lower, 'connection refused')) {
            return 'Verbindung abgelehnt (Port geschlossen?)';
        }
        if (str_contains($lower, 'getaddrinfo') || str_contains($lower, 'name or service not known') || str_contains($lower, 'nodename nor servname')) {
            return 'Hostname konnte nicht aufgelöst werden';
        }
        if (str_contains($lower, 'certificate') || str_contains($lower, 'ssl')) {
            return 'TLS-Fehler: ' . $msg;
        }
        if (str_contains($lower, 'no route') || str_contains($lower, 'unreachable')) {
            return 'Host nicht erreichbar';
        }
        if (str_contains($lower, 'operation failed') && str_starts_with(strtolower($this->baseUrl), 'https://')) {
            return 'TLS-Handshake fehlgeschlagen – antwortet die Node evtl. nur über http://?';
        }
        return $msg !== '' ? $msg : 'Verbindung fehlgeschlagen';
    }
}
