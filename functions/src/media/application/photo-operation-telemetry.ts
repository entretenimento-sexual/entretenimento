import { logger } from 'firebase-functions';

export type PhotoOperationOutcome =
  | 'success'
  | 'partial'
  | 'skipped'
  | 'retryable'
  | 'waiting_retention'
  | 'dead_letter';

export interface PhotoOperationTelemetryInput {
  operation: string;
  outcome: PhotoOperationOutcome;
  startedAt?: number;
  counts?: Readonly<Record<string, number>>;
  details?: Readonly<Record<string, string | number | boolean | null>>;
}

function safeCount(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

/**
 * Telemetria operacional de fotos sem writes adicionais em Firestore.
 *
 * Privacidade:
 * - não recebe UID, photoId, storagePath, URL ou conteúdo do usuário;
 * - emite apenas operação, resultado, duração e contadores agregados;
 * - Cloud Logging continua sendo a fonte operacional, sem custo de persistência
 *   adicional no caminho transacional da mídia.
 */
export function logPhotoOperation(
  input: PhotoOperationTelemetryInput
): void {
  const startedAt = Number(input.startedAt ?? 0);
  const durationMs =
    Number.isFinite(startedAt) && startedAt > 0
      ? Math.max(0, Date.now() - startedAt)
      : 0;
  const counts = Object.fromEntries(
    Object.entries(input.counts ?? {}).map(([key, value]) => [
      key,
      safeCount(value),
    ])
  );

  logger.info('[photoOperation]', {
    photoOperation: {
      schemaVersion: 1,
      operation: String(input.operation ?? '').trim() || 'unknown',
      outcome: input.outcome,
      durationMs,
      counts,
      ...(input.details ? { details: input.details } : {}),
    },
  });
}
