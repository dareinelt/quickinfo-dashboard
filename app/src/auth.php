<?php
declare(strict_types=1);

/**
 * Authentifizierung: Session-basiertes Login mit CSRF-Token und Brute-Force-Schutz.
 */

const QB_LOGIN_MAX_ATTEMPTS = 8;
const QB_LOGIN_LOCK_SECONDS = 600;

function qb_session_start(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $lifetime = qb_config()['session_lifetime'];
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    session_name('qiboard');
    session_set_cookie_params([
        'lifetime' => $lifetime,
        'path'     => '/',
        'secure'   => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    ini_set('session.gc_maxlifetime', (string)$lifetime);
    session_start();

    if (isset($_SESSION['last_activity']) && time() - (int)$_SESSION['last_activity'] > $lifetime) {
        qb_logout();
        session_start();
    }
    $_SESSION['last_activity'] = time();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
}

/** Legt beim allerersten Start den Admin-Benutzer aus den Umgebungsvariablen an. */
function qb_ensure_admin_user(): void
{
    $db = qb_db();
    if ((int)$db->query('SELECT COUNT(*) FROM users')->fetchColumn() > 0) {
        return;
    }
    $cfg = qb_config();
    $stmt = $db->prepare('INSERT IGNORE INTO users (username, password_hash, created_at) VALUES (?, ?, ?)');
    $stmt->execute([$cfg['admin_user'], password_hash($cfg['admin_password'], PASSWORD_DEFAULT), time()]);
    qb_log('Admin-Benutzer "' . $cfg['admin_user'] . '" angelegt.');
}

function qb_current_user(): ?array
{
    if (empty($_SESSION['user_id'])) {
        return null;
    }
    static $user = null;
    if ($user === null) {
        $stmt = qb_db()->prepare('SELECT id, username, created_at, last_login FROM users WHERE id = ?');
        $stmt->execute([(int)$_SESSION['user_id']]);
        $user = $stmt->fetch() ?: false;
    }
    return $user ?: null;
}

function qb_require_auth(): array
{
    $user = qb_current_user();
    if ($user === null) {
        qb_json_error('Nicht angemeldet.', 401);
    }
    return $user;
}

function qb_require_csrf(): void
{
    $token = (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? '');
    if ($token === '' || !hash_equals((string)($_SESSION['csrf'] ?? ''), $token)) {
        qb_json_error('Ungültiges CSRF-Token.', 403);
    }
}

function qb_login_locked(string $ip): int
{
    $stmt = qb_db()->prepare('SELECT attempts, last_attempt FROM login_attempts WHERE ip = ?');
    $stmt->execute([$ip]);
    $row = $stmt->fetch();
    if (!$row) {
        return 0;
    }
    if ((int)$row['attempts'] >= QB_LOGIN_MAX_ATTEMPTS) {
        $remaining = (int)$row['last_attempt'] + QB_LOGIN_LOCK_SECONDS - time();
        if ($remaining > 0) {
            return $remaining;
        }
        qb_db()->prepare('DELETE FROM login_attempts WHERE ip = ?')->execute([$ip]);
    }
    return 0;
}

function qb_login_failed(string $ip): void
{
    qb_db()->prepare(
        'INSERT INTO login_attempts (ip, attempts, last_attempt) VALUES (?, 1, ?)
         ON DUPLICATE KEY UPDATE attempts = attempts + 1, last_attempt = VALUES(last_attempt)'
    )->execute([$ip, time()]);
}

function qb_login(string $username, string $password): array
{
    $ip = qb_client_ip();
    $locked = qb_login_locked($ip);
    if ($locked > 0) {
        qb_json_error('Zu viele Fehlversuche. Bitte in ' . (int)ceil($locked / 60) . ' Minuten erneut versuchen.', 429);
    }

    $stmt = qb_db()->prepare('SELECT id, username, password_hash FROM users WHERE username = ?');
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        qb_login_failed($ip);
        usleep(random_int(150000, 400000));
        qb_json_error('Benutzername oder Passwort falsch.', 401);
    }

    if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
        qb_db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')
            ->execute([password_hash($password, PASSWORD_DEFAULT), $user['id']]);
    }

    qb_db()->prepare('DELETE FROM login_attempts WHERE ip = ?')->execute([$ip]);
    qb_db()->prepare('UPDATE users SET last_login = ? WHERE id = ?')->execute([time(), $user['id']]);

    session_regenerate_id(true);
    $_SESSION['user_id'] = (int)$user['id'];
    $_SESSION['csrf'] = bin2hex(random_bytes(32));

    return ['id' => (int)$user['id'], 'username' => $user['username']];
}

function qb_logout(): void
{
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires' => time() - 42000, 'path' => $p['path'], 'domain' => $p['domain'],
            'secure' => $p['secure'], 'httponly' => $p['httponly'], 'samesite' => $p['samesite'],
        ]);
    }
    session_destroy();
}

function qb_change_password(int $userId, string $current, string $new): void
{
    if (strlen($new) < 8) {
        qb_json_error('Das neue Passwort muss mindestens 8 Zeichen lang sein.', 400);
    }
    $stmt = qb_db()->prepare('SELECT password_hash FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $hash = $stmt->fetchColumn();
    if ($hash === false || !password_verify($current, (string)$hash)) {
        qb_json_error('Das aktuelle Passwort ist falsch.', 403);
    }
    qb_db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?')
        ->execute([password_hash($new, PASSWORD_DEFAULT), $userId]);
}
