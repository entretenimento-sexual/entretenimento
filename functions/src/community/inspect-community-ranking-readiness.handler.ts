// functions/src/community/inspect-community-ranking-readiness.handler.ts
// -----------------------------------------------------------------------------
// INSPECT COMMUNITY RANKING READINESS
// -----------------------------------------------------------------------------
// Diagnóstico administrativo somente-leitura para homologar a troca do ranking
// legado para score v1. Não altera configuração, runtime, índices ou projeções.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import { resolveCommunityDiscoveryRankingMode } from './community-discovery-ranking-mode.policy';
import { hasCommunityOperationsPermission } from './community-operations.authorization';
import { COMMUNITY_DISCOVERY_SCORE_VERSION } from './community-ranking.policy';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';

interface CommunityRankingReadinessInspection {
  requestedMode: 'legacy' | 'score_v1';
  effectiveMode: 'legacy' | 'score_v1';
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
    scoreRequested: boolean;
    scoreIndexReady: boolean;
  };
  canEnableScoreV1: boolean;
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
    const inspection: CommunityRankingReadinessInspection = {
      requestedMode: decision.requestedMode,
      effectiveMode: decision.effectiveMode,
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
        scoreRequested: config['discoveryRankingMode'] === 'score_v1',
        scoreIndexReady: config['discoveryScoreIndexReady'] === true,
      },
      canEnableScoreV1: runtime['ready'] === true
        && Number(runtime['completedScoreVersion'])
          === COMMUNITY_DISCOVERY_SCORE_VERSION,
      generatedAt: Date.now(),
    };

    logger.info('community_ranking_readiness_inspected', {
      actorUid,
      requestedMode: inspection.requestedMode,
      effectiveMode: inspection.effectiveMode,
      fallbackReason: inspection.fallbackReason,
      runtimeReady: inspection.runtime.ready,
      completedScoreVersion: inspection.runtime.completedScoreVersion,
      canEnableScoreV1: inspection.canEnableScoreV1,
    });

    return inspection;
  }
);
