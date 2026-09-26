import { createHash } from 'node:crypto';

export const PHOTO_PREVENTIVE_REVIEW_REASON =
  'preventive_media_review' as const;
export const PHOTO_PREVENTIVE_REVIEW_MESSAGE =
  'Conteúdo aguardando avaliação preventiva antes da distribuição.';

export type PhotoPublicationModerationStatus =
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'FLAGGED'
  | 'HIDDEN'
  | 'REJECTED'
  | 'PRIVATE'
  | 'UNKNOWN';

export interface UnassessedPhotoScoreBreakdown {
  rankingScore: number;
  qualityScore: number;
  engagementScore: number;
  safetyScore: null;
}

export function normalizePhotoPublicationModerationStatus(
  value: unknown
): PhotoPublicationModerationStatus {
  const normalized = String(value ?? '').trim().toUpperCase();

  switch (normalized) {
  case 'PENDING_REVIEW':
  case 'APPROVED':
  case 'FLAGGED':
  case 'HIDDEN':
  case 'REJECTED':
  case 'PRIVATE':
    return normalized;
  default:
    return 'UNKNOWN';
  }
}

export function defaultPhotoPublicationModerationStatus(): 'PENDING_REVIEW' {
  return 'PENDING_REVIEW';
}

export function isPhotoPublicationApproved(value: unknown): boolean {
  return normalizePhotoPublicationModerationStatus(value) === 'APPROVED';
}

export function buildUnassessedPhotoScoreBreakdown():
UnassessedPhotoScoreBreakdown {
  return {
    rankingScore: 0,
    qualityScore: 0,
    engagementScore: 0,
    safetyScore: null,
  };
}

export function buildPreventivePhotoReviewId(
  ownerUid: string,
  photoId: string,
  assetVersion: number
): string {
  return createHash('sha256')
    .update([
      'system',
      PHOTO_PREVENTIVE_REVIEW_REASON,
      ownerUid,
      photoId,
      String(assetVersion),
    ].join('|'))
    .digest('hex')
    .slice(0, 48);
}
