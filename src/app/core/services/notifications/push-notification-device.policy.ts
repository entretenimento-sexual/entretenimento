// src/app/core/services/notifications/push-notification-device.policy.ts
// -----------------------------------------------------------------------------
// Política pura do Web Push do navegador.
// -----------------------------------------------------------------------------

export const DEFAULT_PUSH_SERVICE_WORKER_PATH =
  '/assets/firebase-messaging-sw.js';
export const MIN_PUSH_FCM_TOKEN_LENGTH = 20;

const MIN_VAPID_KEY_LENGTH = 40;
const MAX_VAPID_KEY_LENGTH = 256;
const MIN_INSTALLATION_ID_LENGTH = 16;
const MAX_INSTALLATION_ID_LENGTH = 128;

export function normalizePushVapidKey(value: unknown): string | null {
  const key = String(value ?? '').trim();

  if (
    key.length < MIN_VAPID_KEY_LENGTH ||
    key.length > MAX_VAPID_KEY_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(key)
  ) {
    return null;
  }

  return key;
}

export function isValidPushInstallationId(value: unknown): boolean {
  const installationId = String(value ?? '').trim();

  return (
    installationId.length >= MIN_INSTALLATION_ID_LENGTH &&
    installationId.length <= MAX_INSTALLATION_ID_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(installationId)
  );
}

export function createPushInstallationId(cryptoApi: Crypto): string {
  if (typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID();
  }

  if (typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error(
      'Gerador criptográfico seguro indisponível para a instalação.'
    );
  }

  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, '0')
  ).join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
