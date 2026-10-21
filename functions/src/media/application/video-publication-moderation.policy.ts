export type VideoPublicationModerationStatus =
  | 'APPROVED'
  | 'PENDING_REVIEW'
  | 'FLAGGED'
  | 'HIDDEN'
  | 'REJECTED'
  | 'PRIVATE'
  | 'UNKNOWN';

export type RestrictedVideoModerationStatus =
  | 'PENDING_REVIEW'
  | 'FLAGGED'
  | 'HIDDEN'
  | 'REJECTED';

export interface UnassessedVideoScoreBreakdown {
  rankingScore: number;
  qualityScore: number;
  engagementScore: number;
  safetyScore: null;
  audienceScore: number;
  retentionScore: number;
}

export function normalizeVideoPublicationModerationStatus(
  value: unknown
): VideoPublicationModerationStatus {
  const normalized = String(value ?? '').trim().toUpperCase();

  switch (normalized) {
  case 'APPROVED':
  case 'PENDING_REVIEW':
  case 'FLAGGED':
  case 'HIDDEN':
  case 'REJECTED':
  case 'PRIVATE':
    return normalized;
  default:
    return 'UNKNOWN';
  }
}

export function isRestrictedVideoModerationStatus(
  value: unknown
): value is RestrictedVideoModerationStatus {
  const normalized = normalizeVideoPublicationModerationStatus(value);
  return normalized === 'PENDING_REVIEW' ||
    normalized === 'FLAGGED' ||
    normalized === 'HIDDEN' ||
    normalized === 'REJECTED';
}

/**
 * Processamento e intenção de publicação não equivalem à liberação pública.
 * A revisão administrativa deve liberar explicitamente cada novo vídeo.
 */
export function defaultVideoPublicationModerationStatus(): 'PENDING_REVIEW' {
  return 'PENDING_REVIEW';
}

export function buildUnassessedVideoScoreBreakdown():
UnassessedVideoScoreBreakdown {
  return {
    rankingScore: 0,
    qualityScore: 0,
    engagementScore: 0,
    safetyScore: null,
    audienceScore: 0,
    retentionScore: 0,
  };
}

/**
 * Edições do proprietário não aprovam vídeos, inclusive legados sem status.
 */
export function resolveVideoModerationAfterOwnerEdit(
  currentStatus: unknown
): VideoPublicationModerationStatus {
  return normalizeVideoPublicationModerationStatus(currentStatus);
}

/**
 * Compatibilidade para identificar registros antigos criados quando
 * PENDING_REVIEW era o default de publicação.
 */
export function isLegacyPendingVideoModeration(value: unknown): boolean {
  return normalizeVideoPublicationModerationStatus(value) === 'PENDING_REVIEW';
}
