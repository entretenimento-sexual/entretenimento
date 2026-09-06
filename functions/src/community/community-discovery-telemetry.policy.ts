// functions/src/community/community-discovery-telemetry.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY DISCOVERY TELEMETRY POLICY
// -----------------------------------------------------------------------------
// Monta o payload agregado de observabilidade da entrega da descoberta.
// Deliberadamente não recebe UID, communityId, cursor bruto nem tagId: logs de
// custo e performance não devem virar um read-model comportamental do usuário.
// A métrica de leituras é um proxy operacional do caminho executado e não deve
// ser interpretada como quantidade exata de reads faturados pelo Firestore.
// -----------------------------------------------------------------------------

import type { CommunityDiscoveryRankingMode } from './community-discovery-ranking-mode.policy';
import type { CommunitySourceType } from './community-preview.model';

export const COMMUNITY_DISCOVERY_COST_SEMANTICS =
  'operational_proxy_not_billed_reads' as const;

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
  readonly rankingMode: CommunityDiscoveryRankingMode;
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
  const deliveryDocumentReadProxy =
    projectionDocumentsFetched + membershipReads + cursorProjectionReads;

  return Object.freeze({
    schemaVersion: 2,
    costSemantics: COMMUNITY_DISCOVERY_COST_SEMANTICS,
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
    deliveryDocumentReadProxy,
    projectionReadAmplification: ratio(
      projectionDocumentsFetched,
      cardsReturned
    ),
    membershipReadAmplification: ratio(membershipReads, cardsReturned),
    deliveryReadAmplification: ratio(deliveryDocumentReadProxy, cardsReturned),
    durationMs: normalizeCount(input.durationMs),
    hasCursor: input.hasCursor === true,
    hasTagFilter: input.hasTagFilter === true,
    sourceType: input.sourceType,
    rankingMode: input.rankingMode,
    hasNextPage: input.hasNextPage === true,
  });
}
