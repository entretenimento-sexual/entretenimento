import { createHash, randomBytes } from 'node:crypto';

export const VIDEO_PLAYBACK_SESSION_TTL_MS = 10 * 60 * 1000;
export const VIDEO_PLAYBACK_SESSION_TOKEN_BYTES = 32;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,256}$/;

export interface VideoPlaybackSessionDocument {
  readonly viewerUid: string;
  readonly ownerUid: string;
  readonly videoId: string;
  readonly appId: string | null;
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly consumedAt: number | null;
}

export interface VideoPlaybackSessionValidationInput {
  readonly session: VideoPlaybackSessionDocument | null | undefined;
  readonly viewerUid: unknown;
  readonly ownerUid: unknown;
  readonly videoId: unknown;
  readonly appId: unknown;
  readonly now: number;
}

export interface VideoPlaybackSessionValidationDecision {
  readonly allowed: boolean;
  readonly reason:
    | 'missing'
    | 'identity_mismatch'
    | 'app_mismatch'
    | 'expired'
    | 'already_consumed'
    | null;
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

export function createVideoPlaybackSessionToken(): string {
  return randomBytes(VIDEO_PLAYBACK_SESSION_TOKEN_BYTES).toString('base64url');
}

export function normalizeVideoPlaybackSessionToken(value: unknown): string {
  const token = clean(value);
  return TOKEN_PATTERN.test(token) ? token : '';
}

export function hashVideoPlaybackSessionToken(token: unknown): string {
  const normalized = normalizeVideoPlaybackSessionToken(token);
  return normalized
    ? createHash('sha256').update(normalized).digest('hex')
    : '';
}

export function evaluateVideoPlaybackSession(
  input: VideoPlaybackSessionValidationInput
): VideoPlaybackSessionValidationDecision {
  const session = input.session;

  if (!session) {
    return { allowed: false, reason: 'missing' };
  }

  const viewerUid = clean(input.viewerUid);
  const ownerUid = clean(input.ownerUid);
  const videoId = clean(input.videoId);
  const requestAppId = clean(input.appId);
  const sessionAppId = clean(session.appId);

  if (
    !viewerUid ||
    !ownerUid ||
    !videoId ||
    session.viewerUid !== viewerUid ||
    session.ownerUid !== ownerUid ||
    session.videoId !== videoId
  ) {
    return { allowed: false, reason: 'identity_mismatch' };
  }

  if (sessionAppId && sessionAppId !== requestAppId) {
    return { allowed: false, reason: 'app_mismatch' };
  }

  if (!Number.isFinite(session.expiresAt) || session.expiresAt <= input.now) {
    return { allowed: false, reason: 'expired' };
  }

  if (session.consumedAt !== null) {
    return { allowed: false, reason: 'already_consumed' };
  }

  return { allowed: true, reason: null };
}
