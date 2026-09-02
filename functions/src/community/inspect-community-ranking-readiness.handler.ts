// functions/src/community/inspect-community-ranking-readiness.handler.ts
// -----------------------------------------------------------------------------
// INSPECT COMMUNITY RANKING READINESS
// -----------------------------------------------------------------------------
// Diagnóstico administrativo somente-leitura para homologar a troca do ranking
// legado para a versão atual do score. Não altera configuração, runtime, índices
// ou projeções. A comparação v2 x v3 e a exploração permanecem shadow-only.
// A exposição é diagnosticada somente para a ordenação efetivamente servida.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import {
  COMMUNITY_DISCOVERY_EXPOSURE_COUNTER_SHARDS,
  resolveCommunityDiscoveryExposureDay,
} from './community-discovery-exposure.policy';
import {
  type CommunityDiscoveryRankingMode,
  resolveCommunityDiscoveryRankingMode,
} from './community-discovery-ranking-mode.policy';
import { hasCommunityOperationsPermission } from './community-operations.authorization';
import {
  COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION,
} from './community-ranking-candidate-v3.policy';
import {
  buildCommunityRankingExplorationSimulation,
  COMMUNITY_EXPLORATION_SCAN_DEPTH,
  type CommunityRankingExplorationEntry,
  type CommunityRankingExplorationSimulation,
} from './community-ranking-exploration-simulation.policy';
import {
  buildCommunityRankingExposureDiagnostics,
  type CommunityRankingExposureDiagnostics,
} from './community-ranking-exposure-diagnostics.policy';
import {
  buildCommunityRankingShadowDiagnostics,
  type CommunityRankingShadowDiagnostics,
  type CommunityRankingShadowEntry,
} from './community-ranking-shadow-diagnostics.policy';
import {
  COMMUNITY_DISCOVERY_RANKING_MODE,
  COMMUNITY_DISCOVERY_SCORE_VERSION,
} from './community-ranking.policy';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';

const SHADOW_COMPARISON_TOP_K = 25;

type CommunityRankingOrderField = 'rankScore' | 'discoveryScore';
type CommunityRankingShadowUnavailableReason = 'ranking_cycle_not_ready';

interface CommunityRankingReadinessInspection {
  requestedMode: CommunityDiscoveryRankingMode;
  effectiveMode: CommunityDiscoveryRankingMode;
  targetMode: typeof COMMUNITY_DISCOVERY_RANKING_MODE;
  orderField: CommunityRankingOrderField;
  fallbackReason: string | null;
  policyScoreVersion: number;
  runtime: {
    ready: boolean;
    completedScoreVersion: number | null;
    reachedEnd: boolean;
    lastCycleCompletedAt: number | null;
    lastCycleReady: boolean;
    lastCycleStats: {
      processed: number;
      updated: number;
      unchanged: number;
      orphanProjections: number;
      unsupported: number;
    };
  };
  config: {
    configuredMode: string | null;
    targetScoreRequested: boolean;
    scoreIndexReady: boolean;
  };
  shadowComparison: {
    available: boolean;
    candidateScoreVersion: typeof COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION;
    unavailableReason: CommunityRankingShadowUnavailableReason | null;
    diagnostics: CommunityRankingShadowDiagnostics | null;
    servedExposure: {
      day: string;
      orderField: CommunityRankingOrderField;
      diagnostics: CommunityRankingExposureDiagnostics;
    } | null;
    explorationSimulation: CommunityRankingExplorationSimulation | null;
  };
  canEnableTargetScore: boolean;
  generatedAt: number;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeCount(value: unknown): number {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeTimestamp(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : null;
}

function normalizeVersion(value: unknown): number | null {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function normalizeConfiguredMode(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 64) : null;
}

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'O diagnóstico de ranking não está disponível neste ambiente.'
  );
}

async function assertAuthorized(
  actorUid: string | null,
  authToken: Record<string, unknown> | undefined
): Promise<void> {
  if (!actorUid) {
    throw new HttpsError('unauthenticated', 'Administrador não autenticado.');
  }

  if (authToken?.['email_verified'] !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Verifique o e-mail da conta administrativa para continuar.'
    );
  }

  if (hasCommunityOperationsPermission(authToken, 'community:ranking')) {
    return;
  }

  const actorSnapshot = await db.collection('users').doc(actorUid).get();
  if (
    hasCommunityOperationsPermission(
      actorSnapshot.exists ? actorSnapshot.data() : null,
      'community:ranking'
    )
  ) {
    return;
  }

  throw new HttpsError(
    'permission-denied',
    'Usuário sem permissão para inspecionar o ranking de Comunidades.'
  );
}

function toOfficialShadowEntries(
  documents: readonly { id: string; data(): Record<string, unknown> }[]
): CommunityRankingShadowEntry[] {
  return documents.map((document) => {
    const data = document.data();
    return {
      communityId: document.id,
      score: Number(data['discoveryScore']),
      communityCreatedAt: normalizeTimestamp(data['communityCreatedAt']),
    };
  });
}

function toCandidateShadowEntries(
  documents: readonly { id: string; data(): Record<string, unknown> }[]
): CommunityRankingShadowEntry[] {
  return documents.map((document) => {
    const data = document.data();
    const candidate = asRecord(data['rankingCandidate']);
    return {
      communityId: document.id,
      score: Number(candidate['discoveryScore']),
      communityCreatedAt: normalizeTimestamp(data['communityCreatedAt']),
    };
  });
}

function toExplorationEntries(
  documents: readonly { id: string; data(): Record<string, unknown> }[]
): CommunityRankingExplorationEntry[] {
  return documents.map((document) => {
    const data = document.data();
    const candidate = asRecord(data['rankingCandidate']);
    return {
      communityId: document.id,
      discoveryScore: Number(candidate['discoveryScore']),
      qualityScore: Number(candidate['qualityScore']),
      freshnessScore: Number(candidate['freshnessScore']),
      safetyScore: Number(candidate['safetyScore']),
      communityCreatedAt: normalizeTimestamp(data['communityCreatedAt']),
    };
  });
}

async function inspectServedExposure(
  documents: readonly { id: string; data(): Record<string, unknown> }[],
  now: number,
  orderField: CommunityRankingOrderField
): Promise<{
  day: string;
  orderField: CommunityRankingOrderField;
  diagnostics: CommunityRankingExposureDiagnostics;
}> {
  const day = resolveCommunityDiscoveryExposureDay(now);
  const dayRef = db.collection('community_discovery_exposure_daily').doc(day);
  const shardDescriptors = documents.flatMap((document) =>
    Array.from(
      { length: COMMUNITY_DISCOVERY_EXPOSURE_COUNTER_SHARDS },
      (_, shard) => ({
        communityId: document.id,
        ref: dayRef
          .collection('communities')
          .doc(document.id)
          .collection('shards')
          .doc(String(shard)),
      })
    )
  );
  const exposureByCommunity = new Map<string, number>();

  if (shardDescriptors.length > 0) {
    const snapshots = await db.getAll(
      ...shardDescriptors.map(({ ref }) => ref)
    );

    snapshots.forEach((snapshot, index) => {
      const descriptor = shardDescriptors[index];
      if (!descriptor || !snapshot.exists) return;
      const count = normalizeCount(snapshot.data()?.['count']);
      exposureByCommunity.set(
        descriptor.communityId,
        (exposureByCommunity.get(descriptor.communityId) ?? 0) + count
      );
    });
  }

  return {
    day,
    orderField,
    diagnostics: buildCommunityRankingExposureDiagnostics({
      now,
      entries: documents.map((document) => ({
        exposureCount: exposureByCommunity.get(document.id) ?? 0,
        communityCreatedAt: normalizeTimestamp(
          document.data()['communityCreatedAt']
        ),
      })),
    }),
  };
}

async function queryServedDocuments(
  orderField: CommunityRankingOrderField
) {
  return db
    .collection('community_discovery_index')
    .orderBy(orderField, 'desc')
    .limit(SHADOW_COMPARISON_TOP_K)
    .get();
}

async function inspectShadowComparison(
  runtimeReadyForTarget: boolean,
  servedOrderField: CommunityRankingOrderField
): Promise<CommunityRankingReadinessInspection['shadowComparison']> {
  const projection = db.collection('community_discovery_index');
  const now = Date.now();

  if (!runtimeReadyForTarget) {
    const servedSnapshot = await queryServedDocuments(servedOrderField);
    const servedExposure = await inspectServedExposure(
      servedSnapshot.docs,
      now,
      servedOrderField
    );

    return {
      available: false,
      candidateScoreVersion: COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION,
      unavailableReason: 'ranking_cycle_not_ready',
      diagnostics: null,
      servedExposure,
      explorationSimulation: null,
    };
  }

  const [officialSnapshot, candidateSnapshot] = await Promise.all([
    projection
      .orderBy('discoveryScore', 'desc')
      .limit(SHADOW_COMPARISON_TOP_K)
      .get(),
    projection
      .orderBy('rankingCandidate.discoveryScore', 'desc')
      .limit(COMMUNITY_EXPLORATION_SCAN_DEPTH)
      .get(),
  ]);
  const servedDocuments = servedOrderField === 'discoveryScore'
    ? officialSnapshot.docs
    : (await queryServedDocuments(servedOrderField)).docs;
  const servedExposure = await inspectServedExposure(
    servedDocuments,
    now,
    servedOrderField
  );
  const diagnostics = buildCommunityRankingShadowDiagnostics({
    officialTop: toOfficialShadowEntries(officialSnapshot.docs),
    candidateTop: toCandidateShadowEntries(candidateSnapshot.docs),
    topK: SHADOW_COMPARISON_TOP_K,
    now,
  });
  const explorationSimulation = buildCommunityRankingExplorationSimulation({
    candidateScan: toExplorationEntries(candidateSnapshot.docs),
    now,
  });

  return {
    available: true,
    candidateScoreVersion: COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION,
    unavailableReason: null,
    diagnostics,
    servedExposure,
    explorationSimulation,
  };
}

export const inspectCommunityRankingReadiness = onCall(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<CommunityRankingReadinessInspection> => {
    assertRuntime();
    assertCommunityCallableAppCheck(request.app);

    const actorUid = request.auth?.uid ?? null;
    await assertAuthorized(
      actorUid,
      (request.auth?.token ?? {}) as Record<string, unknown>
    );

    const [configSnapshot, runtimeSnapshot] = await Promise.all([
      db.collection('platform_config').doc('community').get(),
      db.collection('community_ranking_runtime').doc('daily').get(),
    ]);
    const config = configSnapshot.exists ? configSnapshot.data() ?? {} : {};
    const runtime = runtimeSnapshot.exists ? runtimeSnapshot.data() ?? {} : {};
    const decision = resolveCommunityDiscoveryRankingMode(config, runtime);
    const lastCycleStats = asRecord(runtime['lastCycleStats']);
    const configuredMode = normalizeConfiguredMode(config['discoveryRankingMode']);
    const scoreIndexReady = config['discoveryScoreIndexReady'] === true;
    const runtimeReadyForTarget = runtime['ready'] === true
      && Number(runtime['completedScoreVersion'])
        === COMMUNITY_DISCOVERY_SCORE_VERSION;
    const shadowComparison = await inspectShadowComparison(
      runtimeReadyForTarget,
      decision.orderField
    );
    const inspection: CommunityRankingReadinessInspection = {
      requestedMode: decision.requestedMode,
      effectiveMode: decision.effectiveMode,
      targetMode: decision.targetMode,
      orderField: decision.orderField,
      fallbackReason: decision.fallbackReason,
      policyScoreVersion: COMMUNITY_DISCOVERY_SCORE_VERSION,
      runtime: {
        ready: runtime['ready'] === true,
        completedScoreVersion: normalizeVersion(runtime['completedScoreVersion']),
        reachedEnd: runtime['reachedEnd'] === true,
        lastCycleCompletedAt: normalizeTimestamp(runtime['lastCycleCompletedAt']),
        lastCycleReady: runtime['lastCycleReady'] === true,
        lastCycleStats: {
          processed: normalizeCount(lastCycleStats['processed']),
          updated: normalizeCount(lastCycleStats['updated']),
          unchanged: normalizeCount(lastCycleStats['unchanged']),
          orphanProjections: normalizeCount(lastCycleStats['orphanProjections']),
          unsupported: normalizeCount(lastCycleStats['unsupported']),
        },
      },
      config: {
        configuredMode,
        targetScoreRequested: configuredMode === COMMUNITY_DISCOVERY_RANKING_MODE,
        scoreIndexReady,
      },
      shadowComparison,
      canEnableTargetScore: scoreIndexReady && runtimeReadyForTarget,
      generatedAt: Date.now(),
    };

    logger.info('community_ranking_readiness_inspected', {
      actorUid,
      requestedMode: inspection.requestedMode,
      effectiveMode: inspection.effectiveMode,
      targetMode: inspection.targetMode,
      fallbackReason: inspection.fallbackReason,
      runtimeReady: inspection.runtime.ready,
      completedScoreVersion: inspection.runtime.completedScoreVersion,
      canEnableTargetScore: inspection.canEnableTargetScore,
      shadowAvailable: inspection.shadowComparison.available,
      shadowTopK: inspection.shadowComparison.diagnostics?.topK ?? null,
      shadowOverlapRate:
        inspection.shadowComparison.diagnostics?.overlapRate ?? null,
      shadowRankAgreement:
        inspection.shadowComparison.diagnostics?.rankAgreement ?? null,
      shadowColdStartOfficialCoverage:
        inspection.shadowComparison.diagnostics?.coldStart
          .officialAgeCoverageRate ?? null,
      shadowColdStartCandidateCoverage:
        inspection.shadowComparison.diagnostics?.coldStart
          .candidateAgeCoverageRate ?? null,
      shadowColdStartNewShareDelta:
        inspection.shadowComparison.diagnostics?.coldStart.newShareDelta ?? null,
      servedExposureDay:
        inspection.shadowComparison.servedExposure?.day ?? null,
      servedExposureOrderField:
        inspection.shadowComparison.servedExposure?.orderField ?? null,
      servedQualifiedExposures:
        inspection.shadowComparison.servedExposure?.diagnostics
          .totalQualifiedExposures ?? null,
      servedExposureHhi:
        inspection.shadowComparison.servedExposure?.diagnostics.exposureHhi
          ?? null,
      servedNewCommunityExposureShare:
        inspection.shadowComparison.servedExposure?.diagnostics
          .newCommunityExposureShare ?? null,
      explorationEligiblePool:
        inspection.shadowComparison.explorationSimulation?.eligiblePoolCount
          ?? null,
      explorationSelected:
        inspection.shadowComparison.explorationSimulation
          ?.selectedExplorationCount ?? null,
      explorationNewShareAfter:
        inspection.shadowComparison.explorationSimulation?.simulatedNewShare
          ?? null,
      explorationMeanScoreCost:
        inspection.shadowComparison.explorationSimulation?.meanScoreCost
          ?? null,
    });

    return inspection;
  }
);