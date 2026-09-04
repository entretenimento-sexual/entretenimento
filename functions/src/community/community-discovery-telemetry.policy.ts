// functions/src/community/community-discovery-telemetry.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY DISCOVERY TELEMETRY POLICY
// -----------------------------------------------------------------------------
// Monta o payload agregado de observabilidade da entrega da descoberta.
// Deliberadamente não recebe UID, communityId, cursor bruto nem tagId: logs de
// custo e performance não devem virar um read-model comportamental do usuário.
// -----------------------------------------------------------------------------

import type { CommunitySourceType } from './community-preview.model';

export interface CommunityDiscoveryTelemetryInput {
  readonly requestedLimit: number;
  readonly scanLimit: number;
  readonly projectionDocumentsFetched: number;
  readonly projectionDocumentsConsumed: number;
  readonly candidatesEvaluated: number;
  readonly membershipReads: number;
  readonly membershipBatches: number;
  readonly blockedExcluded: number;
  readonly cardsReturned: number;
  readonly cursorProjectionReads: number;
  readonly durationMs: number;
  readonly hasCursor: boolean;
  readonly hasTagFilter: boolean;
  readonly sourceType: CommunitySourceType | null;
  readonly rankingMode: string;
  readonly hasNextPage: boolean;
}

function normalizeCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function ratio(numerator: number, denominator: number): number | null {
  const safeNumerator = normalizeCount(numerator);
  const safeDenominator = normalizeCount(denominator);

  if (safeDenominator === 0) return null;
  return Math.round((safeNumerator / safeDenominator) * 100) / 100;
}

export function buildCommunityDiscoveryTelemetry(
  input: CommunityDiscoveryTelemetryInput
): Readonly<Record<string, unknown>> {
  const projectionDocumentsFetched = normalizeCount(
    input.projectionDocumentsFetched
  );
  const projectionDocumentsConsumed = normalizeCount(
    input.projectionDocumentsConsumed
  );
  const candidatesEvaluated = normalizeCount(input.candidatesEvaluated);
  const membershipReads = normalizeCount(input.membershipReads);
  const membershipBatches = normalizeCount(input.membershipBatches);
  const blockedExcluded = normalizeCount(input.blockedExcluded);
  const cardsReturned = normalizeCount(input.cardsReturned);
  const cursorProjectionReads = normalizeCount(input.cursorProjectionReads);
  const deliveryFirestoreReads =
    projectionDocumentsFetched + membershipReads + cursorProjectionReads;

  return Object.freeze({
    schemaVersion: 1,
    requestedLimit: normalizeCount(input.requestedLimit),
    scanLimit: normalizeCount(input.scanLimit),
    projectionDocumentsFetched,
    projectionDocumentsConsumed,
    candidatesEvaluated,
    membershipReads,
    membershipBatches,
    blockedExcluded,
    cardsReturned,
    cursorProjectionReads,
    deliveryFirestoreReads,
    projectionReadAmplification: ratio(
      projectionDocumentsFetched,
      cardsReturned
    ),
    membershipReadAmplification: ratio(membershipReads, cardsReturned),
    deliveryReadAmplification: ratio(deliveryFirestoreReads, cardsReturned),
    durationMs: normalizeCount(input.durationMs),
    hasCursor: input.hasCursor === true,
    hasTagFilter: input.hasTagFilter === true,
    sourceType: input.sourceType,
    rankingMode: String(input.rankingMode ?? '').trim() || 'unknown',
    hasNextPage: input.hasNextPage === true,
  });
}
