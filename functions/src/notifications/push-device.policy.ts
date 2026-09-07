import { createHash } from 'node:crypto';

export const MAX_PUSH_DEVICES_PER_USER = 10;
export const MIN_PUSH_TOKEN_LENGTH = 20;
export const MAX_PUSH_TOKEN_LENGTH = 4096;

export type PushDevicePlatform = 'web' | 'ios' | 'android';

export interface PushDeviceTokenCandidate {
  documentId: string;
  token: unknown;
}

export interface PushDeliveryTarget {
  token: string;
  registryDocumentIds: string[];
}

const PERMANENT_PUSH_TOKEN_ERROR_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

export function normalizePushToken(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const token = value.trim();
  if (
    token.length < MIN_PUSH_TOKEN_LENGTH ||
    token.length > MAX_PUSH_TOKEN_LENGTH
  ) {
    return null;
  }

  return token;
}

export function resolvePushDevicePlatform(
  value: unknown
): PushDevicePlatform | null {
  const platform = String(value ?? '').trim().toLowerCase();

  switch (platform) {
  case 'web':
  case 'ios':
  case 'android':
    return platform;
  default:
    return null;
  }
}

export function buildPushTokenDocumentId(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function resolvePushDeliveryTargets(
  legacyToken: unknown,
  registryDevices: readonly PushDeviceTokenCandidate[]
): PushDeliveryTarget[] {
  const targetsByToken = new Map<string, PushDeliveryTarget>();

  for (const device of registryDevices) {
    const token = normalizePushToken(device.token);
    const documentId = String(device.documentId ?? '').trim();
    if (!token || !documentId) continue;

    const existing = targetsByToken.get(token);
    if (existing) {
      if (!existing.registryDocumentIds.includes(documentId)) {
        existing.registryDocumentIds.push(documentId);
      }
      continue;
    }

    targetsByToken.set(token, {
      token,
      registryDocumentIds: [documentId],
    });
  }

  const normalizedLegacyToken = normalizePushToken(legacyToken);
  if (normalizedLegacyToken && !targetsByToken.has(normalizedLegacyToken)) {
    targetsByToken.set(normalizedLegacyToken, {
      token: normalizedLegacyToken,
      registryDocumentIds: [],
    });
  }

  return Array.from(targetsByToken.values());
}

export function isPermanentPushTokenErrorCode(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return PERMANENT_PUSH_TOKEN_ERROR_CODES.has(value.trim());
}

export function resolveInvalidPushRegistryDocumentIds(
  targets: readonly PushDeliveryTarget[],
  responseErrorCodes: readonly unknown[]
): string[] {
  const documentIds = new Set<string>();

  for (let index = 0; index < targets.length; index += 1) {
    if (!isPermanentPushTokenErrorCode(responseErrorCodes[index])) continue;

    for (const documentId of targets[index]?.registryDocumentIds ?? []) {
      documentIds.add(documentId);
    }
  }

  return Array.from(documentIds);
}
