import { createHash } from 'node:crypto';

export const MAX_PUSH_DEVICES_PER_USER = 10;
export const MIN_PUSH_TOKEN_LENGTH = 20;
export const MAX_PUSH_TOKEN_LENGTH = 4096;
export const MIN_PUSH_INSTALLATION_ID_LENGTH = 16;
export const MAX_PUSH_INSTALLATION_ID_LENGTH = 128;
export const PUSH_DEVICE_LEASE_REFRESH_MS = 24 * 60 * 60 * 1000;
export const PUSH_DEVICE_STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
export const PUSH_TOKEN_OWNERS_COLLECTION = 'push_token_owners';
export const PUSH_TOKEN_OWNER_SCHEMA_VERSION = 1;

export type PushDevicePlatform = 'web' | 'ios' | 'android';

export interface PushDeviceTokenCandidate {
  documentId: string;
  token: unknown;
}

export interface PushDeliveryTarget {
  token: string;
  registryDocumentIds: string[];
}

export interface PushDeviceRegistrationCandidate {
  token?: unknown;
  platform?: unknown;
  schemaVersion?: unknown;
  lastSeenAt?: unknown;
}

export interface PushTokenOwnerCandidate {
  uid?: unknown;
  deviceId?: unknown;
  schemaVersion?: unknown;
}

export interface PushTokenOwner {
  uid: string;
  deviceId: string;
  schemaVersion: typeof PUSH_TOKEN_OWNER_SCHEMA_VERSION;
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

export function normalizePushInstallationId(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const installationId = value.trim();
  if (
    installationId.length < MIN_PUSH_INSTALLATION_ID_LENGTH ||
    installationId.length > MAX_PUSH_INSTALLATION_ID_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(installationId)
  ) {
    return null;
  }

  return installationId;
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

export function buildPushInstallationDocumentId(installationId: string): string {
  return createHash('sha256').update(installationId, 'utf8').digest('hex');
}

/**
 * Mantido durante a migração do registro v1, cujo document id era derivado do
 * token. Novos registros usam exclusivamente a installation id estável.
 */
export function buildPushTokenDocumentId(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function resolvePushTokenOwner(
  value: PushTokenOwnerCandidate | null | undefined
): PushTokenOwner | null {
  const uid = typeof value?.uid === 'string' ? value.uid.trim() : '';
  const deviceId = typeof value?.deviceId === 'string'
    ? value.deviceId.trim()
    : '';

  if (
    !uid ||
    !/^[a-f0-9]{64}$/.test(deviceId) ||
    value?.schemaVersion !== PUSH_TOKEN_OWNER_SCHEMA_VERSION
  ) {
    return null;
  }

  return {
    uid,
    deviceId,
    schemaVersion: PUSH_TOKEN_OWNER_SCHEMA_VERSION,
  };
}

export function isCanonicalPushTokenOwner(
  value: PushTokenOwnerCandidate | null | undefined,
  uid: string,
  deviceId: string
): boolean {
  const owner = resolvePushTokenOwner(value);
  return Boolean(owner && owner.uid === uid && owner.deviceId === deviceId);
}

/**
 * Owner ausente significa registro legado ainda em migração e permanece
 * entregável. Owner existente, porém inválido, falha fechado para não expor
 * uma notificação a um token cuja autoridade canônica não pode ser provada.
 */
export function shouldDeliverPushTokenToRecipient(
  ownerExists: boolean,
  value: PushTokenOwnerCandidate | null | undefined,
  recipientUid: string
): boolean {
  if (!ownerExists) return true;

  const owner = resolvePushTokenOwner(value);
  const normalizedRecipientUid = String(recipientUid ?? '').trim();
  return Boolean(owner && normalizedRecipientUid && owner.uid === normalizedRecipientUid);
}

export function shouldReleasePushTokenOwner(
  value: PushTokenOwnerCandidate | null | undefined,
  uid: string,
  deviceId: string
): boolean {
  return isCanonicalPushTokenOwner(value, uid, deviceId);
}

export function isPushTokenOwnedByUid(
  value: PushTokenOwnerCandidate | null | undefined,
  uid: string
): boolean {
  const owner = resolvePushTokenOwner(value);
  const normalizedUid = String(uid ?? '').trim();
  return Boolean(owner && normalizedUid && owner.uid === normalizedUid);
}

/**
 * Evita reescrever o mesmo registro em todo bootstrap sem atrasar rotação de
 * token: qualquer mudança material força sincronização imediata. O lease só
 * posterga a atualização de lastSeenAt quando token, plataforma e schema já
 * estão canônicos e o dispositivo foi visto nas últimas 24 horas.
 */
export function isPushDeviceRegistrationFresh(
  current: PushDeviceRegistrationCandidate | null | undefined,
  requestedToken: unknown,
  requestedPlatform: unknown,
  nowMs = Date.now()
): boolean {
  const currentToken = normalizePushToken(current?.token);
  const nextToken = normalizePushToken(requestedToken);
  const currentPlatform = resolvePushDevicePlatform(current?.platform);
  const nextPlatform = resolvePushDevicePlatform(requestedPlatform);
  const lastSeenAtMs = toMillis(current?.lastSeenAt);

  if (
    !currentToken ||
    !nextToken ||
    currentToken !== nextToken ||
    !currentPlatform ||
    !nextPlatform ||
    currentPlatform !== nextPlatform ||
    current?.schemaVersion !== 2 ||
    lastSeenAtMs === null ||
    !Number.isFinite(nowMs)
  ) {
    return false;
  }

  const ageMs = nowMs - lastSeenAtMs;
  return ageMs >= 0 && ageMs < PUSH_DEVICE_LEASE_REFRESH_MS;
}

/**
 * O FCM considera registros sem atividade por aproximadamente um mês como
 * stale. O sender usa este corte para não gastar entrega nem expor alertas em
 * instalações antigas; quando o app voltar a abrir, o registro é sincronizado
 * novamente pelo lifecycle normal.
 */
export function resolvePushDeviceFreshnessCutoffMs(
  nowMs = Date.now()
): number {
  return nowMs - PUSH_DEVICE_STALE_AFTER_MS;
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

export function resolveInvalidPushDeliveryTargets(
  targets: readonly PushDeliveryTarget[],
  responseErrorCodes: readonly unknown[]
): PushDeliveryTarget[] {
  const invalidTargets: PushDeliveryTarget[] = [];

  for (let index = 0; index < targets.length; index += 1) {
    if (!isPermanentPushTokenErrorCode(responseErrorCodes[index])) continue;

    const target = targets[index];
    if (!target) continue;

    invalidTargets.push({
      token: target.token,
      registryDocumentIds: [...target.registryDocumentIds],
    });
  }

  return invalidTargets;
}

export function shouldPruneCurrentPushToken(
  currentToken: unknown,
  invalidToken: unknown
): boolean {
  const normalizedCurrent = normalizePushToken(currentToken);
  const normalizedInvalid = normalizePushToken(invalidToken);

  return Boolean(
    normalizedCurrent &&
    normalizedInvalid &&
    normalizedCurrent === normalizedInvalid
  );
}

export function resolveInvalidPushRegistryDocumentIds(
  targets: readonly PushDeliveryTarget[],
  responseErrorCodes: readonly unknown[]
): string[] {
  const documentIds = new Set<string>();
  const invalidTargets = resolveInvalidPushDeliveryTargets(
    targets,
    responseErrorCodes
  );

  for (const target of invalidTargets) {
    for (const documentId of target.registryDocumentIds) {
      documentIds.add(documentId);
    }
  }

  return Array.from(documentIds);
}

function toMillis(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const timestamp = value as {
    toMillis?: () => number;
    toDate?: () => Date;
  } | null | undefined;

  if (typeof timestamp?.toMillis === 'function') {
    const millis = timestamp.toMillis();
    return Number.isFinite(millis) ? millis : null;
  }

  if (typeof timestamp?.toDate === 'function') {
    const millis = timestamp.toDate().getTime();
    return Number.isFinite(millis) ? millis : null;
  }

  return null;
}
