// functions/src/community/inspect-community-purge-readiness.handler.ts
// -----------------------------------------------------------------------------
// INSPECT COMMUNITY PURGE READINESS
// -----------------------------------------------------------------------------
// Diagnóstico administrativo somente-leitura para homologação do purge.
// Não executa exclusão nem altera lifecycle/configuração.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import { hasCommunityLifecycleHold } from './community-lifecycle.policy';
import { hasCommunityPurgeOperationsPermission } from './community-purge-operations.authorization';
import { readCommunityPurgeEvidence } from './community-purge-readiness.service';
import { resolveCommunityPurgeScheduleOptions } from './community-purge-schedule.policy';
import {
  evaluateCommunityPurgeReadiness,
  resolveCommunityPurgeGraceDays,
} from './community-purge.policy';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';

interface InspectCommunityPurgeReadinessRequest {
  communityId?: unknown;
}

interface InspectCommunityPurgeReadinessResponse {
  communityId: string;
  eligible: boolean;
  denialReason: string | null;
  purgeEligibleAt: number | null;
  graceDays: number;
  schedulerEnabled: boolean;
  snapshot: {
    sourceType: string | null;
    status: string | null;
    ownerReleased: boolean;
    memberCount: number | null;
    retentionHold: boolean;
  };
  evidence: {
    hasLiveMemberships: boolean | null;
    hasRetainedContent: boolean | null;
    hasModerationEvidence: boolean | null;
    failedProbes: readonly string[];
  };
  generatedAt: number;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'O diagnóstico de purge de Comunidades não está disponível neste ambiente.'
  );
}

function normalizeCommunityId(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : '';
}

function normalizeOptionalCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : null;
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

  if (hasCommunityPurgeOperationsPermission(authToken)) return;

  const actorSnapshot = await db.collection('users').doc(actorUid).get();
  if (hasCommunityPurgeOperationsPermission(actorSnapshot.data())) return;

  throw new HttpsError(
    'permission-denied',
    'Usuário sem permissão para inspecionar o purge de Comunidades.'
  );
}

export const inspectCommunityPurgeReadiness = onCall<InspectCommunityPurgeReadinessRequest>(
  {
    region: FUNCTIONS_REGION,
    enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
  },
  async (request): Promise<InspectCommunityPurgeReadinessResponse> => {
    assertRuntime();
    assertCommunityCallableAppCheck(request.app);

    const actorUid = request.auth?.uid ?? null;
    await assertAuthorized(
      actorUid,
      (request.auth?.token ?? {}) as Record<string, unknown>
    );

    const communityId = normalizeCommunityId(request.data?.communityId);
    if (!communityId) {
      throw new HttpsError('invalid-argument', 'Comunidade inválida para inspeção.');
    }

    const [communitySnapshot, configSnapshot] = await Promise.all([
      db.collection('communities').doc(communityId).get(),
      db.collection('platform_config').doc('community').get(),
    ]);

    if (!communitySnapshot.exists) {
      throw new HttpsError('not-found', 'Comunidade não encontrada.');
    }

    const community = (communitySnapshot.data() ?? {}) as Record<string, unknown>;
    const config = configSnapshot.exists ? configSnapshot.data() ?? {} : {};
    const evidenceRead = await readCommunityPurgeEvidence(communityId);
    const graceDays = resolveCommunityPurgeGraceDays(config);
    const decision = evaluateCommunityPurgeReadiness(
      community,
      evidenceRead.evidence,
      Date.now(),
      graceDays
    );
    const scheduleOptions = resolveCommunityPurgeScheduleOptions(config);
    const source = (community['source'] ?? {}) as Record<string, unknown>;
    const metrics = (community['metrics'] ?? {}) as Record<string, unknown>;
    const generatedAt = Date.now();

    logger.info('community_purge_readiness_inspected', {
      actorUid,
      communityId,
      eligible: decision.eligible,
      denialReason: decision.denialReason,
      failedProbes: evidenceRead.failedProbes,
    });

    return {
      communityId,
      eligible: decision.eligible,
      denialReason: decision.denialReason,
      purgeEligibleAt: decision.purgeEligibleAt,
      graceDays,
      schedulerEnabled: scheduleOptions.enabled,
      snapshot: {
        sourceType: typeof source['type'] === 'string' ? source['type'] : null,
        status: typeof community['status'] === 'string' ? community['status'] : null,
        ownerReleased: String(community['ownerUid'] ?? '').trim().length === 0,
        memberCount: normalizeOptionalCount(metrics['memberCount']),
        retentionHold: hasCommunityLifecycleHold(community),
      },
      evidence: {
        ...evidenceRead.evidence,
        failedProbes: evidenceRead.failedProbes,
      },
      generatedAt,
    };
  }
);
