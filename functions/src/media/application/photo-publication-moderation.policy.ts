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

export function defaultPhotoPublicationModerationStatus(): 'APPROVED' {
  return 'APPROVED';
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

