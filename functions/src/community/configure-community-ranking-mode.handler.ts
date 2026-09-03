// functions/src/community/configure-community-ranking-mode.handler.ts
// -----------------------------------------------------------------------------
// CONFIGURE COMMUNITY RANKING MODE
// -----------------------------------------------------------------------------
// Operação administrativa restrita para ativar a versão canônica atual somente
// após índice + backfill prontos, ou voltar explicitamente ao ranking legado.
// Não existe caminho para forçar uma versão parcial ou arbitrária.
// -----------------------------------------------------------------------------

import { logger } from 'firebase-functions';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { assertRecentAuthentication } from '../account_lifecycle/_shared';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  REQUIRE_COMMUNITY_APP_CHECK,
  assertCommunityCallableAppCheck,
} from './community-callable-security';
import { hasCommunityOperationsPermission } from './community-operations.authorization';
import { consumeCommunityRateLimit } from './community-rate-limit.service';
import {
  type CommunityRankingRolloutAction,
  evaluateCommunityRankingRollout,
} from './community-ranking-rollout.policy';
import { isCommunityPreviewRuntimeAvailable } from './community-runtime.guard';

interface ConfigureCommunityRankingModeRequest {
  action?: unknown;
}

interface ConfigureCommunityRankingModeResponse {
  action: CommunityRankingRolloutAction;
  previousMode: string | null;
  mode: string;
  scoreVersion: number;
  updated: boolean;
  generatedAt: number;
}

function normalizeAction(value: unknown): CommunityRankingRolloutAction | null {
  return value === 'enable_current' || value === 'rollback_legacy'
    ? value
    : null;
}

function normalizeMode(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 64) : null;
}

function assertRuntime(): void {
  if (isCommunityPreviewRuntimeAvailable()) return;

  throw new HttpsError(
    'failed-precondition',
    'A configuração de ranking não está disponível neste ambiente.'
  );
}

async function assertAuthorized(
  actorUid: string | null,
  authToken: Record<string, unknown> | undefined
): Promise<string> {
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
    return actorUid;
  }

  const actorSnapshot = await db.collection('users').doc(actorUid).get();
  if (
    hasCommunityOperationsPermission(
      actorSnapshot.exists ? actorSnapshot.data() : null,
      'community:ranking'
    )
  ) {
    return actorUid;
  }

  throw new HttpsError(
    'permission-denied',
    'Usuário sem permissão para configurar o ranking de Comunidades.'
  );
}

function rolloutFailureMessage(reason: string | null): string {
  if (reason === 'score_index_not_ready') {
    return 'O índice do ranking atual ainda não foi homologado.';
  }

  if (reason === 'score_backfill_not_ready') {
    return 'O backfill do ranking atual ainda não concluiu um ciclo completo.';
  }

  return 'O backfill disponível pertence a outra versão de ranking.';
}

export const configureCommunityRankingMode =
  onCall<ConfigureCommunityRankingModeRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_COMMUNITY_APP_CHECK,
    },
    async (request): Promise<ConfigureCommunityRankingModeResponse> => {
      assertRuntime();
      assertCommunityCallableAppCheck(request.app);

      const action = normalizeAction(request.data?.action);
      if (!action) {
        throw new HttpsError(
          'invalid-argument',
          'Ação de configuração de ranking inválida.'
        );
      }

      const actorUid = await assertAuthorized(
        request.auth?.uid ?? null,
        (request.auth?.token ?? {}) as Record<string, unknown>
      );
      assertRecentAuthentication(
        (request.auth?.token ?? undefined) as
          | Record<string, unknown>
          | undefined
      );
      await consumeCommunityRateLimit({
        action: 'operations_ranking',
        actorUid,
      });

      const now = Date.now();
      const configRef = db.collection('platform_config').doc('community');
      const runtimeRef = db.collection('community_ranking_runtime').doc('daily');

      const result = await db.runTransaction(async (transaction) => {
        const [configSnapshot, runtimeSnapshot] = await Promise.all([
          transaction.get(configRef),
          transaction.get(runtimeRef),
        ]);
        const config = configSnapshot.exists ? configSnapshot.data() ?? {} : {};
        const runtime = runtimeSnapshot.exists ? runtimeSnapshot.data() ?? {} : {};
        const decision = evaluateCommunityRankingRollout({
          action,
          rawConfig: config,
          rawRuntime: runtime,
        });

        if (!decision.allowed) {
          throw new HttpsError(
            'failed-precondition',
            rolloutFailureMessage(decision.denialReason)
          );
        }

        const previousMode = normalizeMode(config['discoveryRankingMode']);
        const updated = previousMode !== decision.targetMode;

        if (updated) {
          transaction.set(configRef, {
            discoveryRankingMode: decision.targetMode,
            rankingModeUpdatedAt: now,
            rankingModeUpdatedBy: actorUid,
          }, { merge: true });
        }

        return {
          previousMode,
          mode: decision.targetMode,
          scoreVersion: decision.scoreVersion,
          updated,
        };
      });

      logger.info('community_ranking_mode_configured', {
        actorUid,
        action,
        previousMode: result.previousMode,
        mode: result.mode,
        scoreVersion: result.scoreVersion,
        updated: result.updated,
      });

      return {
        action,
        ...result,
        generatedAt: now,
      };
    }
  );
