import { describe, expect, it, vi } from 'vitest';

import {
  createPushInstallationId,
  isValidPushInstallationId,
  normalizePushVapidKey,
} from './push-notification-device.policy';

describe('push-notification-device.policy', () => {
  it('aceita somente uma VAPID key pública com formato plausível', () => {
    expect(normalizePushVapidKey(undefined)).toBeNull();
    expect(normalizePushVapidKey('placeholder')).toBeNull();
    expect(normalizePushVapidKey(`B${'a'.repeat(86)}`)).not.toBeNull();
  });

  it('gera installation id criptográfica compatível com a política do backend', () => {
    const randomUUID = vi.fn(
      () => '2c191cf7-339a-4ee3-9d70-f142dbc3334f'
    );
    const cryptoApi = {
      randomUUID,
      getRandomValues: vi.fn(),
    } as unknown as Crypto;

    const installationId = createPushInstallationId(cryptoApi);

    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(isValidPushInstallationId(installationId)).toBe(true);
  });

  it('rejeita ids que poderiam carregar fingerprint ou caracteres fora da política', () => {
    expect(isValidPushInstallationId('device model/browser 123')).toBe(false);
    expect(isValidPushInstallationId('curto')).toBe(false);
  });
});
