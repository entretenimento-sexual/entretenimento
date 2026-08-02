import { createHash } from 'node:crypto';

import { db } from '../../firebaseApp';

export type VideoViewSource =
  | 'discover'
  | 'profile'
  | 'latest'
  | 'top'
  | 'boosted'
  | 'unknown';

export interface VideoViewSessionDocument {
  viewerUid?: unknown;
  ownerUid?: unknown;
  videoId?: unknown;
  source?: unknown;
  appId?: unknown;
  issuedAt?: unknown;
  expiresAt?: unknown;
}

export const VIDEO_VIEW_SESSION_COLLECTION = 'video_view_sessions';
export const VIDEO_VIEW_SESSION_RATE_LIMIT_COLLECTION =
  'video_view_session_rate_limits';

export function cleanVideoViewSource(value: unknown): VideoViewSource {
  const source = String(value ?? '').trim().toLowerCase();

  if (
    source === 'discover' ||
    source === 'profile' ||
    source === 'latest' ||
    source === 'top' ||
    source === 'boosted'
  ) {
    return source;
  }

  return 'unknown';
}

export function hashVideoViewSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function hashVideoViewRateLimitKey(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function getVideoViewSessionRef(token: string) {
  return db.collection(VIDEO_VIEW_SESSION_COLLECTION).doc(
    hashVideoViewSessionToken(token)
  );
}
