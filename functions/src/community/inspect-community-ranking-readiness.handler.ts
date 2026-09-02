// functions/src/community/inspect-community-ranking-readiness.handler.ts
// -----------------------------------------------------------------------------
// INSPECT COMMUNITY RANKING READINESS
// -----------------------------------------------------------------------------
// Diagnóstico administrativo somente-leitura para homologar a troca do ranking
// legado para a versão atual do score. Não altera configuração, runtime, índices
// ou projeções. A comparação v2 x v3 permanece agregada e shadow-only.
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
  type CommunityDiscoveryRankingMode,
  resolveCommunityDiscoveryRankingMode,
} from './community-discovery-ranking-mode.policy';
import { hasCommunityOperationsPermission } from './community-operations.authorization';
import {
  COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION,
} from './community-ranking-candidate-v3.policy';
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

type CommunityRankingShadowUnavailableReason = 'ranking_cycle_not_ready';

interface CommunityRankingReadinessInspection {
  requestedMode: CommunityDiscoveryRankingMode;
  effectiveMode: CommunityDiscoveryRankingMode;
  targetMode: typeof COMMUNITY_DISCOVERY_RANKING_MODE;
  orderField: 'rankScore' | 'discoveryScore';
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

async function inspectShadowComparison(
  runtimeReadyForTarget: boolean
): Promise<CommunityRankingReadinessInspection['shadowComparison']> {
  if (!runtimeReadyForTarget) {
    return {
      available: false,
      candidateScoreVersion: COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION,
      unavailableReason: 'ranking_cycle_not_ready',
      diagnostics: null,
    };
  }

  const projection = db.collection('community_discovery_index');
  const [officialSnapshot, candidateSnapshot] = await Promise.all([
    projection
      .orderBy('discoveryScore', 'desc')
      .limit(SHADOW_COMPARISON_TOP_K)
      .get(),
    projection
      .orderBy('rankingCandidate.discoveryScore', 'desc')
      .limit(SHADOW_COMPARISON_TOP_K)
      .get(),
  ]);
  const diagnostics = buildCommunityRankingShadowDiagnostics({
    officialTop: toOfficialShadowEntries(officialSnapshot.docs),
    candidateTop: toCandidateShadowEntries(candidateSnapshot.docs),
    topK: SHADOW_COMPARISON_TOP_K,
    now: Date.now(),
  });

  return {
    available: true,
    candidateScoreVersion: COMMUNITY_DISCOVERY_CANDIDATE_SCORE_VERSION,
    unavailableReason: null,
    diagnostics,
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
    const shadowComparison = await inspectShadowComparison(runtimeReadyForTarget);
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
    });

    return inspection;
  }
);
