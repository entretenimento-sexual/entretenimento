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
import {
  readCommunityPurgeInspection,
  type CommunityPurgeInspection,
} from './community-purge-inspection.service';
import { hasCommunityPurgeOperationsPermission } from './community-purge-operations.authorization';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';

interface InspectCommunityPurgeReadinessRequest {
  communityId?: unknown;
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
  async (request): Promise<CommunityPurgeInspection> => {
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

    const inspection = await readCommunityPurgeInspection(communityId);
    if (!inspection) {
      throw new HttpsError('not-found', 'Comunidade não encontrada.');
    }

    logger.info('community_purge_readiness_inspected', {
      actorUid,
      communityId,
      schedulerMode: inspection.schedulerMode,
      eligible: inspection.eligible,
      denialReason: inspection.denialReason,
      failedProbes: inspection.evidence.failedProbes,
    });

    return inspection;
  }
);
