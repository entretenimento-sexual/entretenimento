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
 * Publicação comum não depende de aprovação humana. APPROVED aqui significa
 * somente "sem restrição de moderação". A fila administrativa é acionada por
 * denúncias, e quarentenas usam FLAGGED/HIDDEN.
 */
export function defaultVideoPublicationModerationStatus(): 'APPROVED' {
  return 'APPROVED';
}

/**
 * Edição feita pelo proprietário não abre uma nova revisão e jamais remove uma
 * restrição já aplicada pela moderação.
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

export function isLegacyPendingVideoModeration(value: unknown): boolean {
  return normalizeVideoPublicationModerationStatus(value) === 'PENDING_REVIEW';
}
