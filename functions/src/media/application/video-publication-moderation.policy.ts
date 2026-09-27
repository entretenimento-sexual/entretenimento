import { createHash } from 'node:crypto';

export const VIDEO_PREVENTIVE_REVIEW_REASON =
  'preventive_media_review' as const;
export const VIDEO_PREVENTIVE_REVIEW_MESSAGE =
  'Conteúdo aguardando avaliação preventiva antes da distribuição.';

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
 * Toda nova publicação nasce não avaliada. PENDING_REVIEW não significa
 * reprovação: significa apenas que a mídia ainda não recebeu uma decisão
 * explícita de segurança e, portanto, fica fora da distribuição pública.
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

export function buildPreventiveVideoReviewId(
  ownerUid: string,
  videoId: string,
  assetVersion: number
): string {
  return createHash('sha256')
    .update([
      'system',
      VIDEO_PREVENTIVE_REVIEW_REASON,
      ownerUid,
      videoId,
      String(assetVersion),
    ].join('|'))
    .digest('hex')
    .slice(0, 48);
}

/**
 * Edição do proprietário nunca concede aprovação. APPROVED permanece aprovado;
 * estados restritos continuam restritos; conteúdo ainda não avaliado permanece
 * em revisão preventiva.
 */
export function resolveVideoModerationAfterOwnerEdit(
  currentStatus: unknown
): 'APPROVED' | 'PENDING_REVIEW' | RestrictedVideoModerationStatus {
  const normalized = normalizeVideoPublicationModerationStatus(currentStatus);

  if (isRestrictedVideoModerationStatus(normalized)) {
    return normalized;
  }

  return normalized === 'APPROVED' ? 'APPROVED' : 'PENDING_REVIEW';
}

export function isLegacyPendingVideoModeration(value: unknown): boolean {
  return normalizeVideoPublicationModerationStatus(value) === 'PENDING_REVIEW';
}
