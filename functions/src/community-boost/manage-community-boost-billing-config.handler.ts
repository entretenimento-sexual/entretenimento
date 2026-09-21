// functions/src/community-boost/manage-community-boost-billing-config.handler.ts
// -----------------------------------------------------------------------------
// COMMUNITY BOOST BILLING CONFIG
// -----------------------------------------------------------------------------
// Configuração comercial backend-only. Nenhum preço fica no ranking, associação
// oficial ou frontend. Campanhas novas recebem snapshot imutável da versão ativa.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { assertRecentAuthentication } from '../account_lifecycle/_shared';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  REQUIRE_CALLABLE_APP_CHECK,
  assertCallableAppCheck,
} from '../shared/security/callable-app-check';
import {
  COMMUNITY_BOOST_CURRENCY,
  normalizeCommunityBoostBillingConfig,
} from './community-boost.policy';

interface ManageCommunityBoostBillingConfigRequest {
  readonly operationId?: unknown;
  readonly active?: unknown;
  readonly rateCpmCents?: unknown;
  readonly minBudgetCents?: unknown;
  readonly maxBudgetCents?: unknown;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{8,128}$/;

function cleanOperationId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function assertAdmin(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const uid = String(auth?.uid ?? '').trim();
  const token = auth?.token ?? {};
  const roles = Array.isArray(token['roles']) ? token['roles'] : [];
  const admin =
    token['admin'] === true
    || token['role'] === 'admin'
    || roles.includes('admin');

  if (!uid) {
    throw new HttpsError('unauthenticated', 'Administrador não autenticado.');
  }
  if (!admin) {
    throw new HttpsError(
      'permission-denied',
      'A configuração de Community Boost exige acesso administrativo.'
    );
  }

  return uid;
}

export const manageCommunityBoostBillingConfig =
  onCall<ManageCommunityBoostBillingConfigRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK,
    },
    async (request) => {
      assertCallableAppCheck(request.app);
      const adminUid = assertAdmin(request.auth);
      assertRecentAuthentication(request.auth?.token);
      const operationId = cleanOperationId(request.data?.operationId);
      const active = request.data?.active === true;
      const rateCpmCents = positiveInteger(request.data?.rateCpmCents);
      const minBudgetCents = positiveInteger(request.data?.minBudgetCents);
      const maxBudgetCents = positiveInteger(request.data?.maxBudgetCents);

      if (
        !operationId
        || !rateCpmCents
        || !minBudgetCents
        || !maxBudgetCents
        || minBudgetCents > maxBudgetCents
      ) {
        throw new HttpsError(
          'invalid-argument',
          'Revise a configuração comercial de Community Boost.'
        );
      }

      const now = Date.now();
      const configRef = db
        .collection('community_boost_billing_config')
        .doc('current');
      const requestRef = db
        .collection('community_boost_billing_config_requests')
        .doc(`${adminUid}:${operationId}`);
      const auditRef = db
        .collection('community_boost_audit')
        .doc(`billing-config:${adminUid}:${operationId}`);

      return db.runTransaction(async (transaction) => {
        const [configSnapshot, requestSnapshot] = await Promise.all([
          transaction.get(configRef),
          transaction.get(requestRef),
        ]);

        if (requestSnapshot.exists) {
          const existing = requestSnapshot.data() ?? {};
          if (
            existing['active'] !== active
            || existing['rateCpmCents'] !== rateCpmCents
            || existing['minBudgetCents'] !== minBudgetCents
            || existing['maxBudgetCents'] !== maxBudgetCents
          ) {
            throw new HttpsError(
              'already-exists',
              'O operationId já foi utilizado para outra configuração.'
            );
          }

          return {
            applied: false,
            version: Number(existing['version']) || 0,
            active: existing['active'] === true,
          };
        }

        const current = configSnapshot.exists
          ? configSnapshot.data() ?? {}
          : {};
        const currentVersion = Math.max(
          0,
          Math.trunc(Number(current['version']) || 0)
        );
        const next = {
          active,
          version: currentVersion + 1,
          currency: COMMUNITY_BOOST_CURRENCY,
          rateCpmCents,
          minBudgetCents,
          maxBudgetCents,
          updatedAt: now,
          updatedBy: adminUid,
        };
        const normalized = normalizeCommunityBoostBillingConfig(next);
        if (active && !normalized) {
          throw new HttpsError(
            'invalid-argument',
            'A configuração ativa de Community Boost está inconsistente.'
          );
        }

        transaction.set(configRef, next, { merge: false });
        transaction.create(requestRef, {
          operationId,
          version: next.version,
          active,
          rateCpmCents,
          minBudgetCents,
          maxBudgetCents,
          expiresAt: now + 7 * 24 * 60 * 60 * 1_000,
          createdAt: now,
        });
        transaction.create(auditRef, {
          action: 'community_boost_billing_config_changed',
          actorUid: adminUid,
          previousVersion: currentVersion || null,
          nextVersion: next.version,
          previousActive: current['active'] === true,
          nextActive: active,
          rateCpmCents,
          minBudgetCents,
          maxBudgetCents,
          createdAt: now,
        });

        return {
          applied: true,
          version: next.version,
          active,
        };
      });
    }
  );
