// functions/src/community/community-discovery-projection-batch.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY DISCOVERY PROJECTION BATCH POLICY
// -----------------------------------------------------------------------------
// Dimensiona a leitura incremental da projeção sanitizada usada na descoberta.
// O orçamento total de varredura continua sendo definido pelo handler; esta
// política reduz over-fetch no caso comum e amplia o lote apenas quando a taxa
// observada de entrega indica que mais documentos serão necessários.
// -----------------------------------------------------------------------------

const MAX_PROJECTION_BATCH_SIZE = 25;
const MIN_OBSERVED_DELIVERY_RATE = 0.25;

export interface CommunityDiscoveryProjectionBatchInput {
  readonly remainingCards: number;
  readonly remainingScanBudget: number;
  readonly projectionDocumentsConsumed: number;
  readonly cardsReturned: number;
}

function normalizeCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

export function resolveCommunityDiscoveryProjectionBatchSize(
  input: CommunityDiscoveryProjectionBatchInput
): number {
  const remainingCards = Math.min(
    normalizeCount(input.remainingCards),
    MAX_PROJECTION_BATCH_SIZE - 1
  );
  const remainingScanBudget = normalizeCount(input.remainingScanBudget);

  if (remainingCards === 0 || remainingScanBudget === 0) {
    return 0;
  }

  const minimumBatchSize = Math.min(
    remainingCards + 1,
    remainingScanBudget,
    MAX_PROJECTION_BATCH_SIZE
  );
  const projectionDocumentsConsumed = normalizeCount(
    input.projectionDocumentsConsumed
  );

  if (projectionDocumentsConsumed === 0) {
    return minimumBatchSize;
  }

  const cardsReturned = Math.min(
    normalizeCount(input.cardsReturned),
    projectionDocumentsConsumed
  );
  const observedDeliveryRate = cardsReturned / projectionDocumentsConsumed;
  const effectiveDeliveryRate = Math.max(
    observedDeliveryRate,
    MIN_OBSERVED_DELIVERY_RATE
  );
  const estimatedRequiredDocuments = Math.ceil(
    remainingCards / effectiveDeliveryRate
  ) + 1;

  return Math.min(
    Math.max(estimatedRequiredDocuments, minimumBatchSize),
    remainingScanBudget,
    MAX_PROJECTION_BATCH_SIZE
  );
}
