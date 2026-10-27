export const FAILED_FEED_PHOTO_TTL_MS = 2 * 60 * 60 * 1000;

export function isExpiredFeedPhotoPending(
  doc: { feedPublicationPending?: unknown; feedPublicationExpiresAtMs?: unknown },
  now: number
): boolean {
  const expires = Number(doc.feedPublicationExpiresAtMs);
  return doc.feedPublicationPending === true &&
    Number.isFinite(expires) && expires > 0 && expires <= now;
}

/** Publicação posterior à criação de uma obrigação de exclusão é proibida. */
export function isFeedPhotoCleanupStaged(value: { feedPublicationCleanupStagedAtMs?: unknown }): boolean {
  const stamp = Number(value.feedPublicationCleanupStagedAtMs ?? 0);
  return Number.isFinite(stamp) && stamp > 0;
}

/** Somente o conflito de elegibilidade gerado pela proteção transacional é benigno. */
export function isBenignFeedPhotoDeletionRace(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const detail = error as { code?: unknown; message?: unknown };
  return (detail.code === 'failed-precondition' ||
    detail.code === 'functions/failed-precondition') &&
    detail.message === 'Upload não elegível para descarte.';
}
