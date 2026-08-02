import { createHash } from 'node:crypto';

import { db } from '../../firebaseApp';

export const PHOTO_VIEW_SESSION_COLLECTION = 'media_photo_view_sessions';
export const PHOTO_VIEW_SESSION_RATE_LIMIT_COLLECTION =
  'media_photo_view_session_rate_limits';

export type PhotoViewSource =
  | 'discover'
  | 'profile'
  | 'latest'
  | 'top'
  | 'boosted'
  | 'unknown';

export interface PhotoViewSessionDocument {
  viewerUid?: unknown;
  ownerUid?: unknown;
  photoId?: unknown;
  source?: unknown;
  appId?: unknown;
  issuedAt?: unknown;
  expiresAt?: unknown;
}

export function cleanPhotoViewSource(value: unknown): PhotoViewSource {
  const normalized = String(value ?? '').trim().toLowerCase();

  if (
    normalized === 'discover' ||
    normalized === 'profile' ||
    normalized === 'latest' ||
    normalized === 'top' ||
    normalized === 'boosted'
  ) {
    return normalized;
  }

  return 'unknown';
}

export function hashPhotoViewSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function hashPhotoViewRateLimitKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

export function getPhotoViewSessionRef(sessionId: string) {
  return db.collection(PHOTO_VIEW_SESSION_COLLECTION).doc(
    hashPhotoViewSessionToken(sessionId)
  );
}
