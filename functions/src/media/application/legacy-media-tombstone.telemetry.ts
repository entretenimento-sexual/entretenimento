import { logger } from 'firebase-functions';

export const LEGACY_MEDIA_TOMBSTONE_TARGET_REMOVAL_DATE = '2026-12-31';

export type LegacyMediaTombstoneEndpoint =
  | 'unpublishPhoto'
  | 'unpublishVideo';

export type LegacyMediaTombstoneOutcome =
  | 'unauthenticated'
  | 'invalid_argument'
  | 'permission_denied'
  | 'semantic_rejected';

/**
 * Telemetria de retirada das APIs tombstone de unpublish.
 *
 * Privacidade:
 * - não registra UID, photoId, videoId, payload ou conteúdo;
 * - registra apenas endpoint, resultado e a data-alvo de retirada;
 * - Cloud Logging é a fonte operacional para decidir a remoção.
 *
 * Critério de retirada:
 * 1. zero consumidor conhecido no repositório;
 * 2. zero chamadas observadas na janela operacional acordada;
 * 3. remoção explícita do export e da Function em mudança própria.
 */
export function logLegacyMediaTombstoneUse(
  endpoint: LegacyMediaTombstoneEndpoint,
  outcome: LegacyMediaTombstoneOutcome
): void {
  logger.warn('[legacyMediaTombstone]', {
    legacyMediaTombstone: {
      schemaVersion: 1,
      endpoint,
      outcome,
      targetRemovalDate: LEGACY_MEDIA_TOMBSTONE_TARGET_REMOVAL_DATE,
      removalCondition: 'zero_observed_calls_and_zero_repo_consumers',
    },
  });
}
