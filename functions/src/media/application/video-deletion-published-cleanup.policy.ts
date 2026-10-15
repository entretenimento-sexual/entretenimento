/**
 * Per-asset result. QUEUED_FOR_RETRY means a durable recovery document has
 * been written or is already present (including a manual-review dead letter).
 */
export type PublishedAssetCleanupResult =
  | 'DELETED'
  | 'QUEUED_FOR_RETRY'
  | 'ACTIVE_REFERENCE'
  | 'INVALID_PATH';

export type PublishedAssetsSummary = 'DELETED' | 'QUEUED_FOR_RETRY' | 'BLOCKED';

/** A single blocked file must keep the parent deletion job available. */
export function summarizePublishedAssetCleanupResults(
  video: PublishedAssetCleanupResult,
  poster: PublishedAssetCleanupResult
): PublishedAssetsSummary {
  if (
    video === 'ACTIVE_REFERENCE' || poster === 'ACTIVE_REFERENCE' ||
    video === 'INVALID_PATH' || poster === 'INVALID_PATH'
  ) {
    return 'BLOCKED';
  }
  if (video === 'QUEUED_FOR_RETRY' || poster === 'QUEUED_FOR_RETRY') {
    return 'QUEUED_FOR_RETRY';
  }
  return 'DELETED';
}
