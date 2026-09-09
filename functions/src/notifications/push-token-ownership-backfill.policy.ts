import {
  normalizePushToken,
  PUSH_DEVICE_STALE_AFTER_MS,
  PUSH_TOKEN_OWNER_SCHEMA_VERSION,
  resolvePushTokenOwner,
  type PushTokenOwnerCandidate,
} from './push-device.policy';

export const PUSH_TOKEN_OWNERSHIP_BACKFILL_SOURCE = 'push_devices_v1';

export type PushTokenOwnershipBackfillCandidateSkipReason =
  | 'invalid_path'
  | 'invalid_token'
  | 'invalid_last_seen'
  | 'stale';

export interface PushTokenOwnershipBackfillCandidate {
  uid: string;
  deviceId: string;
  devicePath: string;
  token: string;
  lastSeenAtMs: number;
}

export interface PushTokenOwnershipBackfillOwnerCandidate
  extends PushTokenOwnerCandidate {
  migrationSource?: unknown;
  migrationLastSeenAtMs?: unknown;
  migrationDevicePath?: unknown;
}

export type PushTokenOwnershipBackfillDecision =
  | {
    action: 'claim';
    reason: 'missing_owner';
  }
  | {
    action: 'replace';
    reason: 'newer_backfill_candidate' | 'deterministic_tie_break';
  }
  | {
    action: 'skip';
    reason:
      | 'canonical_owner_present'
      | 'malformed_owner'
      | 'older_or_equal_backfill_candidate';
  };

export type PushTokenOwnershipBackfillCandidateResolution =
  | {
    candidate: PushTokenOwnershipBackfillCandidate;
    reason: null;
  }
  | {
    candidate: null;
    reason: PushTokenOwnershipBackfillCandidateSkipReason;
  };

export function resolvePushTokenOwnershipBackfillCandidate(
  devicePathValue: unknown,
  data: Record<string, unknown> | null | undefined,
  nowMs = Date.now()
): PushTokenOwnershipBackfillCandidateResolution {
  const parsedPath = parsePushDevicePath(devicePathValue);

  if (!parsedPath) {
    return {candidate: null, reason: 'invalid_path'};
  }

  const token = normalizePushToken(data?.['token']);
  if (!token) {
    return {candidate: null, reason: 'invalid_token'};
  }

  const lastSeenAtMs = toMillis(data?.['lastSeenAt']);
  if (
    lastSeenAtMs === null ||
    !Number.isFinite(nowMs) ||
    lastSeenAtMs < 0 ||
    lastSeenAtMs > nowMs
  ) {
    return {candidate: null, reason: 'invalid_last_seen'};
  }

  if (lastSeenAtMs < nowMs - PUSH_DEVICE_STALE_AFTER_MS) {
    return {candidate: null, reason: 'stale'};
  }

  return {
    candidate: {
      uid: parsedPath.uid,
      deviceId: parsedPath.deviceId,
      devicePath: parsedPath.devicePath,
      token,
      lastSeenAtMs,
    },
    reason: null,
  };
}

/**
 * Runtime ownership sempre vence o backfill. Somente um owner previamente
 * criado pelo próprio backfill pode ser substituído e apenas por evidência
 * mais recente (ou pelo desempate lexical determinístico da mesma data).
 */
export function decidePushTokenOwnershipBackfill(
  ownerExists: boolean,
  ownerValue: PushTokenOwnershipBackfillOwnerCandidate | null | undefined,
  candidate: PushTokenOwnershipBackfillCandidate
): PushTokenOwnershipBackfillDecision {
  if (!ownerExists) {
    return {action: 'claim', reason: 'missing_owner'};
  }

  const owner = resolvePushTokenOwner(ownerValue);
  if (!owner) {
    return {action: 'skip', reason: 'malformed_owner'};
  }

  if (ownerValue?.migrationSource !== PUSH_TOKEN_OWNERSHIP_BACKFILL_SOURCE) {
    return {action: 'skip', reason: 'canonical_owner_present'};
  }

  const existingLastSeenAtMs = normalizeFiniteNumber(
    ownerValue?.migrationLastSeenAtMs
  );
  const existingDevicePath = normalizeDevicePath(
    ownerValue?.migrationDevicePath
  );

  if (
    existingLastSeenAtMs === null ||
    !existingDevicePath ||
    existingDevicePath.uid !== owner.uid ||
    existingDevicePath.deviceId !== owner.deviceId
  ) {
    return {action: 'skip', reason: 'malformed_owner'};
  }

  if (candidate.lastSeenAtMs > existingLastSeenAtMs) {
    return {action: 'replace', reason: 'newer_backfill_candidate'};
  }

  if (
    candidate.lastSeenAtMs === existingLastSeenAtMs &&
    candidate.devicePath < existingDevicePath.devicePath
  ) {
    return {action: 'replace', reason: 'deterministic_tie_break'};
  }

  return {action: 'skip', reason: 'older_or_equal_backfill_candidate'};
}

export function buildPushTokenOwnershipBackfillOwner(
  candidate: PushTokenOwnershipBackfillCandidate
): PushTokenOwnershipBackfillOwnerCandidate {
  return {
    uid: candidate.uid,
    deviceId: candidate.deviceId,
    schemaVersion: PUSH_TOKEN_OWNER_SCHEMA_VERSION,
    migrationSource: PUSH_TOKEN_OWNERSHIP_BACKFILL_SOURCE,
    migrationLastSeenAtMs: candidate.lastSeenAtMs,
    migrationDevicePath: candidate.devicePath,
  };
}

function parsePushDevicePath(value: unknown): {
  uid: string;
  deviceId: string;
  devicePath: string;
} | null {
  if (typeof value !== 'string') return null;

  const devicePath = value.trim();
  const segments = devicePath.split('/');
  if (
    segments.length !== 4 ||
    segments[0] !== 'users' ||
    !segments[1] ||
    segments[2] !== 'push_devices' ||
    !segments[3] ||
    !/^[a-f0-9]{64}$/.test(segments[3])
  ) {
    return null;
  }

  return {
    uid: segments[1],
    deviceId: segments[3],
    devicePath,
  };
}

function normalizeDevicePath(value: unknown): {
  uid: string;
  deviceId: string;
  devicePath: string;
} | null {
  return parsePushDevicePath(value);
}

function normalizeFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
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
