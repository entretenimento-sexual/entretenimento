// functions/src/payments/application/cancel-platform-subscription-renewal.handler.ts
// -----------------------------------------------------------------------------
// CANCEL PLATFORM SUBSCRIPTION RENEWAL
// -----------------------------------------------------------------------------
// O cancelamento encerra novas cobranças no provedor sem retirar o período já
// quitado. A solicitação é persistida antes da chamada externa e possui retry.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  assertCallableAppCheck,
} from '../../shared/security/callable-app-check';
import {
  consumeBackendRateLimitQuota,
} from '../../shared/security/backend-rate-limit.service';
import {
  ASAAS_API_KEY,
  resolveAsaasApiRuntimeConfig,
} from '../config/asaas.config';
import type {
  PlatformRecurringSubscriptionDoc,
  PlatformRecurringSubscriptionStateDoc,
} from '../domain/platform-recurring-subscription.model';
import {
  AsaasPaymentProvider,
} from '../infrastructure/providers/asaas.provider';
import {
  PLATFORM_SUBSCRIPTION_COLLECTION,
  PLATFORM_SUBSCRIPTION_STATE_COLLECTION,
} from './platform-recurring-subscription.service';
import {
  assertRecurringContractBuyer,
} from './recurring-contract-authority.policy';
import {
  cancelRecurringContractAtProvider,
  requestRecurringContractCancellation,
} from './recurring-provider-cancellation.service';
import {
  getActivePlatformSubscriptionEntitlement,
} from './platform-subscription-entitlement.service';

interface CancelRenewalResponse {
  changed: boolean;
  renewalEnabled: false;
  providerCancellationStatus: 'completed' | 'pending' | 'not_configured';
  accessActive: boolean;
  accessEndsAt: number | null;
}

export const cancelPlatformSubscriptionRenewal =
  onCall<Record<string, never>>(
    {
      region: FUNCTIONS_REGION,
      secrets: [ASAAS_API_KEY],
    },
    async (request): Promise<CancelRenewalResponse> => {
      const uid = request.auth?.uid ?? null;

      if (!uid) {
        throw new HttpsError(
          'unauthenticated',
          'Usuário não autenticado.'
        );
      }

      assertCallableAppCheck(request.app);

      await consumeBackendRateLimitQuota({
        action: 'billing:cancel-platform-renewal',
        subject: uid,
        config: {
          burstWindowMs: 60 * 60 * 1_000,
          burstMax: 3,
          sustainedWindowMs: 24 * 60 * 60 * 1_000,
          sustainedMax: 10,
        },
        message:
          'Muitas solicitações de cancelamento foram feitas. Tente novamente mais tarde.',
      });

      const stateSnapshot = await db
        .collection(PLATFORM_SUBSCRIPTION_STATE_COLLECTION)
        .doc(uid)
        .get();
      const state = stateSnapshot.exists
        ? stateSnapshot.data() as PlatformRecurringSubscriptionStateDoc
        : null;
      const entitlement =
        await getActivePlatformSubscriptionEntitlement(uid);

      if (!state?.currentContractId) {
        return {
          changed: false,
          renewalEnabled: false,
          providerCancellationStatus: 'not_configured',
          accessActive: entitlement.active,
          accessEndsAt: entitlement.endsAt,
        };
      }

      const contractSnapshot = await db
        .collection(PLATFORM_SUBSCRIPTION_COLLECTION)
        .doc(state.currentContractId)
        .get();

      if (!contractSnapshot.exists) {
        throw new HttpsError(
          'data-loss',
          'A assinatura recorrente atual está inconsistente.',
          { reason: 'recurring_contract_missing' }
        );
      }

      const contract =
        contractSnapshot.data() as PlatformRecurringSubscriptionDoc;
      assertRecurringContractBuyer(contract.buyerUid, uid);

      if (state.renewalEnabled !== true) {
        return {
          changed: false,
          renewalEnabled: false,
          providerCancellationStatus:
            contract.needsProviderCancellation === true
              ? 'pending'
              : 'completed',
          accessActive: entitlement.active,
          accessEndsAt: entitlement.endsAt,
        };
      }

      const requested = await requestRecurringContractCancellation({
        contractId: state.currentContractId,
        reason: 'user-request',
        expectedBuyerUid: uid,
      });

      if (!requested) {
        throw new HttpsError(
          'failed-precondition',
          'A assinatura recorrente atual não pôde ser validada.'
        );
      }

      const provider = new AsaasPaymentProvider({
        runtime: resolveAsaasApiRuntimeConfig(),
        apiKey: ASAAS_API_KEY.value(),
      });

      let providerCancellationStatus: 'completed' | 'pending' = 'completed';

      try {
        await cancelRecurringContractAtProvider({
          contractId: requested.id,
          provider,
          reason: 'user-request',
        });
      } catch {
        providerCancellationStatus = 'pending';
      }

      return {
        changed: true,
        renewalEnabled: false,
        providerCancellationStatus,
        accessActive: entitlement.active,
        accessEndsAt: entitlement.endsAt,
      };
    }
  );
