export type VideoPublicationModerationStatus =
  | 'APPROVED'
  | 'PENDING_REVIEW'
  | 'FLAGGED'
  | 'HIDDEN'
  | 'REJECTED'
  | 'PRIVATE'
  | 'UNKNOWN';

export type RestrictedVideoModerationStatus =
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
  return normalized === 'FLAGGED' ||
    normalized === 'HIDDEN' ||
    normalized === 'REJECTED';
}

/**
 * Nova publicação entra ativa por padrão.
 *
 * PENDING_REVIEW continua existindo como estado de quarentena posterior,
 * acionável por denúncia ou por mecanismos automáticos/tempo-real.
 */
export function defaultVideoPublicationModerationStatus(): 'APPROVED' {
  return 'APPROVED';
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
 * Edição do proprietário preserva restrições impostas pela moderação.
 * Estados não restritos permanecem publicáveis sem fila preventiva.
 */
export function resolveVideoModerationAfterOwnerEdit(
  currentStatus: unknown
): 'APPROVED' | RestrictedVideoModerationStatus {
  const normalized = normalizeVideoPublicationModerationStatus(currentStatus);

  if (isRestrictedVideoModerationStatus(normalized)) {
    return normalized;
  }

  return 'APPROVED';
}

/**
 * Compatibilidade para identificar registros antigos criados quando
 * PENDING_REVIEW era o default de publicação.
 */
export function isLegacyPendingVideoModeration(value: unknown): boolean {
  return normalizeVideoPublicationModerationStatus(value) === 'PENDING_REVIEW';
}
