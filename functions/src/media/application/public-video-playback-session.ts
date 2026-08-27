import { createHash, randomBytes } from 'node:crypto';

export const PUBLIC_VIDEO_PLAYBACK_SESSION_TTL_MS = 5 * 60 * 1000;
export const PUBLIC_VIDEO_PLAYBACK_SESSION_COLLECTION = 'playback_sessions';
export const PUBLIC_VIDEO_PLAYBACK_SESSION_SCHEMA_VERSION = 1;

const MIN_TOKEN_LENGTH = 32;
const MAX_TOKEN_LENGTH = 128;
const SESSION_CLOCK_TOLERANCE_MS = 1_000;

export interface PublicVideoPlaybackSessionData {
  schemaVersion?: unknown;
  viewerUid?: unknown;
  ownerUid?: unknown;
  videoId?: unknown;
  tokenHash?: unknown;
  issuedAt?: unknown;
  earliestQualifiedAt?: unknown;
  expiresAt?: unknown;
  requiredPlaybackMs?: unknown;
  videoVersion?: unknown;
  consumedAt?: unknown;
}

export type PublicVideoPlaybackSessionFailureReason =
  | 'invalid-token'
  | 'identity-mismatch'
  | 'invalid-session'
  | 'consumed'
  | 'expired'
  | 'too-early'
  | 'stale-video';

export type PublicVideoPlaybackSessionValidation =
  | {
    valid: true;
    tokenHash: string;
    requiredPlaybackMs: number;
    issuedAt: number;
    expiresAt: number;
  }
  | {
    valid: false;
    reason: PublicVideoPlaybackSessionFailureReason;
  };

function finitePositiveInteger(value: unknown): number {
  const parsed = Number(value ?? 0);

  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : 0;
}

function cleanId(value: unknown): string {
  const normalized = String(value ?? '').trim();

  return normalized &&
    normalized.length <= 128 &&
    !normalized.includes('/')
    ? normalized
    : '';
}

export function normalizePublicVideoPlaybackToken(value: unknown): string {
  const token = String(value ?? '').trim();

  if (
    token.length < MIN_TOKEN_LENGTH ||
    token.length > MAX_TOKEN_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(token)
  ) {
    return '';
  }

  return token;
}

export function createPublicVideoPlaybackToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashPublicVideoPlaybackToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function validatePublicVideoPlaybackSession(input: {
  data: PublicVideoPlaybackSessionData | null | undefined;
  playbackToken: unknown;
  viewerUid: string;
  ownerUid: string;
  videoId: string;
  videoVersion: number;
  now: number;
}): PublicVideoPlaybackSessionValidation {
  const playbackToken = normalizePublicVideoPlaybackToken(input.playbackToken);

  if (!playbackToken) {
    return { valid: false, reason: 'invalid-token' };
  }

  const data = input.data ?? {};
  const expectedTokenHash = hashPublicVideoPlaybackToken(playbackToken);
  const tokenHash = String(data.tokenHash ?? '').trim();

  if (!tokenHash || tokenHash !== expectedTokenHash) {
    return { valid: false, reason: 'invalid-token' };
  }

  if (
    cleanId(data.viewerUid) !== input.viewerUid ||
    cleanId(data.ownerUid) !== input.ownerUid ||
    cleanId(data.videoId) !== input.videoId
  ) {
    return { valid: false, reason: 'identity-mismatch' };
  }

  const schemaVersion = finitePositiveInteger(data.schemaVersion);
  const issuedAt = finitePositiveInteger(data.issuedAt);
  const earliestQualifiedAt = finitePositiveInteger(data.earliestQualifiedAt);
  const expiresAt = finitePositiveInteger(data.expiresAt);
  const requiredPlaybackMs = finitePositiveInteger(data.requiredPlaybackMs);
  const videoVersion = finitePositiveInteger(data.videoVersion);
  const consumedAt = finitePositiveInteger(data.consumedAt);
  const now = finitePositiveInteger(input.now);

  if (
    schemaVersion !== PUBLIC_VIDEO_PLAYBACK_SESSION_SCHEMA_VERSION ||
    !issuedAt ||
    !earliestQualifiedAt ||
    !expiresAt ||
    !requiredPlaybackMs ||
    !videoVersion ||
    !now ||
    earliestQualifiedAt < issuedAt + requiredPlaybackMs ||
    expiresAt <= earliestQualifiedAt ||
    expiresAt > issuedAt + PUBLIC_VIDEO_PLAYBACK_SESSION_TTL_MS +
      SESSION_CLOCK_TOLERANCE_MS
  ) {
    return { valid: false, reason: 'invalid-session' };
  }

  if (consumedAt > 0) {
    return { valid: false, reason: 'consumed' };
  }

  if (expiresAt <= now) {
    return { valid: false, reason: 'expired' };
  }

  if (earliestQualifiedAt > now) {
    return { valid: false, reason: 'too-early' };
  }

  if (videoVersion !== finitePositiveInteger(input.videoVersion)) {
    return { valid: false, reason: 'stale-video' };
  }

  return {
    valid: true,
    tokenHash: expectedTokenHash,
    requiredPlaybackMs,
    issuedAt,
    expiresAt,
  };
}
