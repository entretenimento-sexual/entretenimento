// functions/src/community/community-discovery-membership-batch.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY DISCOVERY MEMBERSHIP BATCH POLICY
// -----------------------------------------------------------------------------
// Dimensiona somente os lotes de leituras canônicas de membership usados para
// aplicar bloqueios na descoberta. Não substitui nem relaxa a leitura da fonte
// canônica: reduz over-read quando faltam poucos cards e aumenta o lote quando
// a amostra anterior indica muitos bloqueios, preservando segurança e ordem.
// -----------------------------------------------------------------------------

const MAX_MEMBERSHIP_BATCH_SIZE = 24;
const MIN_OBSERVED_VISIBILITY_RATE = 0.25;

export interface CommunityDiscoveryMembershipBatchInput {
  readonly remainingCards: number;
  readonly candidatesEvaluated: number;
  readonly blockedExcluded: number;
}

function normalizeCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

export function resolveCommunityDiscoveryMembershipBatchSize(
  input: CommunityDiscoveryMembershipBatchInput
): number {
  const remainingCards = Math.min(
    normalizeCount(input.remainingCards),
    MAX_MEMBERSHIP_BATCH_SIZE
  );

  if (remainingCards === 0) return 0;

  const candidatesEvaluated = normalizeCount(input.candidatesEvaluated);
  if (candidatesEvaluated === 0) {
    return remainingCards;
  }

  const blockedExcluded = Math.min(
    normalizeCount(input.blockedExcluded),
    candidatesEvaluated
  );
  const visibleCandidates = candidatesEvaluated - blockedExcluded;
  const observedVisibilityRate = visibleCandidates / candidatesEvaluated;
  const effectiveVisibilityRate = Math.max(
    observedVisibilityRate,
    MIN_OBSERVED_VISIBILITY_RATE
  );
  const estimatedRequiredReads = Math.ceil(
    remainingCards / effectiveVisibilityRate
  );

  return Math.min(
    Math.max(estimatedRequiredReads, remainingCards),
    MAX_MEMBERSHIP_BATCH_SIZE
  );
}
