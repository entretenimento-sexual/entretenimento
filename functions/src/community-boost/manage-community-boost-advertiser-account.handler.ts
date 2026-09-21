// functions/src/community-boost/manage-community-boost-advertiser-account.handler.ts
// -----------------------------------------------------------------------------
// COMMUNITY BOOST ADVERTISER ACCOUNT
// -----------------------------------------------------------------------------
// Elegibilidade comercial patrocinada backend-only. Não é plano, assinatura,
// autoridade oficial nem score. Autoriza faturamento postpaid e limita apenas o
// orçamento máximo que uma campanha individual pode declarar.
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
  COMMUNITY_BOOST_POLICY_VERSION,
} from './community-boost.policy';

interface ManageCommunityBoostAdvertiserAccountRequest {
  readonly operationId?: unknown;
  readonly advertiserUid?: unknown;
  readonly active?: unknown;
  readonly maxCampaignBudgetCents?: unknown;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const SAFE_OPERATION_ID_PATTERN = /^[A-Za-z0-9:_-]{8,128}$/;

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function cleanOperationId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_OPERATION_ID_PATTERN.test(normalized) ? normalized : null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function assertAdmin(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): string {
  const uid = cleanId(auth?.uid);
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
      'A elegibilidade de Community Boost exige acesso administrativo.'
    );
  }

  return uid;
}

export const manageCommunityBoostAdvertiserAccount =
  onCall<ManageCommunityBoostAdvertiserAccountRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK,
    },
    async (request) => {
      assertCallableAppCheck(request.app);
      const adminUid = assertAdmin(request.auth);
      assertRecentAuthentication(request.auth?.token);

      const operationId = cleanOperationId(request.data?.operationId);
      const advertiserUid = cleanId(request.data?.advertiserUid);
      const active =
        request.data?.active === true
          ? true
          : request.data?.active === false
            ? false
            : null;
      const maxCampaignBudgetCents = positiveInteger(
        request.data?.maxCampaignBudgetCents
      );

      if (
        !operationId
        || !advertiserUid
        || active === null
        || !maxCampaignBudgetCents
      ) {
        throw new HttpsError(
          'invalid-argument',
          'Revise a elegibilidade do anunciante Community Boost.'
        );
      }

      const now = Date.now();
      const accountRef = db
        .collection('community_boost_advertiser_accounts')
        .doc(advertiserUid);
      const requestRef = db
        .collection('community_boost_advertiser_account_requests')
        .doc(`${adminUid}:${operationId}`);
      const auditRef = db
        .collection('community_boost_audit')
        .doc(`advertiser:${adminUid}:${operationId}`);

      return db.runTransaction(async (transaction) => {
        const [accountSnapshot, requestSnapshot] = await Promise.all([
          transaction.get(accountRef),
          transaction.get(requestRef),
        ]);

        if (requestSnapshot.exists) {
          const existing = requestSnapshot.data() ?? {};
          if (
            existing['advertiserUid'] !== advertiserUid
            || existing['active'] !== active
            || existing['maxCampaignBudgetCents'] !== maxCampaignBudgetCents
          ) {
            throw new HttpsError(
              'already-exists',
              'O operationId já foi utilizado para outra elegibilidade.'
            );
          }

          return {
            advertiserUid,
            active,
            applied: false,
          };
        }

        const current = accountSnapshot.exists
          ? accountSnapshot.data() ?? {}
          : {};
        const createdAt =
          typeof current['createdAt'] === 'number'
          && Number.isFinite(current['createdAt'])
          && current['createdAt'] > 0
            ? Math.trunc(current['createdAt'])
            : now;
        const next = {
          policyVersion: COMMUNITY_BOOST_POLICY_VERSION,
          advertiserUid,
          active,
          billingMode: 'postpaid',
          currency: COMMUNITY_BOOST_CURRENCY,
          maxCampaignBudgetCents,
          createdAt,
          updatedAt: now,
          updatedBy: adminUid,
        };

        transaction.set(accountRef, next, { merge: false });
        transaction.create(requestRef, {
          operationId,
          advertiserUid,
          active,
          maxCampaignBudgetCents,
          expiresAt: now + 7 * 24 * 60 * 60 * 1_000,
          createdAt: now,
        });
        transaction.create(auditRef, {
          action: 'community_boost_advertiser_account_changed',
          advertiserUid,
          actorUid: adminUid,
          previousActive: current['active'] === true,
          nextActive: active,
          previousMaxCampaignBudgetCents:
            current['maxCampaignBudgetCents'] ?? null,
          nextMaxCampaignBudgetCents: maxCampaignBudgetCents,
          createdAt: now,
        });

        return {
          advertiserUid,
          active,
          applied: true,
        };
      });
    }
  );
