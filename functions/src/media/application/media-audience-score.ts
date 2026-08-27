export interface MediaViewScoreInput {
  readonly viewsCount: unknown;
  readonly uniqueViewersCount: unknown;
}

/**
 * Sinal bruto de audiência contabilizada no backend.
 *
 * Visualizadores únicos recebem peso maior para reduzir o benefício de
 * repetição pelo mesmo usuário. Recência não participa deste contador: idade
 * da publicação nunca deve aumentar artificialmente audiência/relevância.
 */
export function calculateMediaViewScore(input: MediaViewScoreInput): number {
  const viewsCount = normalizeNonNegativeInteger(input.viewsCount);
  const uniqueViewersCount = normalizeNonNegativeInteger(
    input.uniqueViewersCount
  );

  return Math.min(
    Number.MAX_SAFE_INTEGER,
    viewsCount * 4 + uniqueViewersCount * 6
  );
}

function normalizeNonNegativeInteger(value: unknown): number {
  const parsed = Number(value ?? 0);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.floor(parsed);
}
