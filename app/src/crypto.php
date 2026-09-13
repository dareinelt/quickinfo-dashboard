<?php
declare(strict_types=1);

/**
 * Verschlüsselung der Node-API-Keys mit AES-256-GCM.
 * Der Schlüssel wird per HKDF-ähnlicher Ableitung aus APP_SECRET gewonnen.
 * Format des Chiffrats: base64( iv[12] | tag[16] | ciphertext )
 */

function qb_crypto_key(): string
{
    static $key = null;
    if ($key === null) {
        $key = hash_hkdf('sha256', qb_config()['app_secret'], 32, 'qiboard-node-api-key');
    }
    return $key;
}

function qb_encrypt(string $plain): string
{
    $iv = random_bytes(12);
    $tag = '';
    $cipher = openssl_encrypt($plain, 'aes-256-gcm', qb_crypto_key(), OPENSSL_RAW_DATA, $iv, $tag, '', 16);
    if ($cipher === false) {
        throw new RuntimeException('Verschlüsselung fehlgeschlagen.');
    }
    return base64_encode($iv . $tag . $cipher);
}

function qb_decrypt(string $encoded): ?string
{
    $raw = base64_decode($encoded, true);
    if ($raw === false || strlen($raw) < 28) {
        return null;
    }
    $iv = substr($raw, 0, 12);
    $tag = substr($raw, 12, 16);
    $cipher = substr($raw, 28);
    $plain = openssl_decrypt($cipher, 'aes-256-gcm', qb_crypto_key(), OPENSSL_RAW_DATA, $iv, $tag);
    return $plain === false ? null : $plain;
}

function qb_key_prefix(string $key): string
{
    return substr($key, 0, 8);
}
