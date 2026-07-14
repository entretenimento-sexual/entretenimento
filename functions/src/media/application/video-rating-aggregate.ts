export interface VideoRatingAggregateInput {
  ratingsCount?: unknown;
  ratingTotal?: unknown;
  ratingAverage?: unknown;
}

export interface VideoRatingAggregate {
  ratingsCount: number;
  ratingTotal: number;
  ratingAverage: number;
}

export function normalizeVideoRating(value: unknown): number | null {
  const rating = Number(value);

  return Number.isInteger(rating) && rating >= 1 && rating <= 5
    ? rating
    : null;
}

function normalizeCount(value: unknown): number {
  const count = Number(value ?? 0);

  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function normalizeTotal(value: unknown): number | null {
  const total = Number(value);

  return Number.isFinite(total) && total >= 0 ? total : null;
}

function normalizeAverage(value: unknown): number {
  const average = Number(value ?? 0);

  return Number.isFinite(average)
    ? Math.max(0, Math.min(5, average))
    : 0;
}

function roundAverage(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Calcula a próxima média sem consultar toda a subcoleção de avaliações.
 *
 * `previousRating` nulo representa a primeira nota do usuário. Quando existe,
 * a quantidade permanece estável e apenas o total é ajustado pela diferença.
 */
export function buildNextVideoRatingAggregate(
  current: VideoRatingAggregateInput,
  previousRating: number | null,
  nextRating: number
): VideoRatingAggregate {
  const normalizedNext = normalizeVideoRating(nextRating);
  const normalizedPrevious = normalizeVideoRating(previousRating);

  if (normalizedNext === null) {
    throw new Error('A avaliação precisa ser um número inteiro entre 1 e 5.');
  }

  const currentCount = normalizeCount(current.ratingsCount);
  const fallbackTotal = roundAverage(
    normalizeAverage(current.ratingAverage) * currentCount
  );
  const currentTotal = normalizeTotal(current.ratingTotal) ?? fallbackTotal;
  const ratingsCount = normalizedPrevious === null
    ? currentCount + 1
    : Math.max(1, currentCount);
  const ratingTotal = Math.max(
    0,
    currentTotal - (normalizedPrevious ?? 0) + normalizedNext
  );
  const ratingAverage = ratingsCount > 0
    ? roundAverage(ratingTotal / ratingsCount)
    : 0;

  return {
    ratingsCount,
    ratingTotal,
    ratingAverage,
  };
}
