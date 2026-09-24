// functions/src/payments/application/cancel-platform-subscription-downgrade.handler.ts
// -----------------------------------------------------------------------------
// CANCEL PLATFORM SUBSCRIPTION DOWNGRADE
// -----------------------------------------------------------------------------
// Cancela somente a mudança de plano futura. A assinatura e o período pago
// permanecem intactos; o valor recorrente atual é restaurado no provider.
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { assertRecentAuthentication } from '../../account_lifecycle/_shared';
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
  assertAsaasSubscriptionUpdateEnabled,
  resolveAsaasApiRuntimeConfig,
} from '../config/asaas.config';
import type {
  PlatformRecurringSubscriptionStateDoc,
} from '../domain/platform-recurring-subscription.model';
import {
  AsaasPaymentProvider,
} from '../infrastructure/providers/asaas.provider';
import {
  PLATFORM_SUBSCRIPTION_STATE_COLLECTION,
} from './platform-recurring-subscription.service';
import {
  requestCancelRecurringPlanDowngrade,
  revertPendingRecurringPlanChangeAtProvider,
} from './recurring-platform-subscription-plan-change.service';

interface CancelDowngradeResponse {
  canceled: true;
  providerUpdateStatus: 'applied' | 'pending';
}

export const cancelPlatformSubscriptionDowngrade =
  onCall<Record<string, never>>(
    {
      region: FUNCTIONS_REGION,
      secrets: [ASAAS_API_KEY],
    },
    async (request): Promise<CancelDowngradeResponse> => {
      const uid = request.auth?.uid ?? null;

      if (!uid) {
        throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
      }

      assertCallableAppCheck(request.app);
      assertRecentAuthentication(
        (request.auth?.token ?? undefined) as
          | Record<string, unknown>
          | undefined
      );
      assertAsaasSubscriptionUpdateEnabled();

      await consumeBackendRateLimitQuota({
        action: 'billing:cancel-platform-downgrade',
        subject: uid,
        config: {
          burstWindowMs: 60 * 60 * 1_000,
          burstMax: 3,
          sustainedWindowMs: 24 * 60 * 60 * 1_000,
          sustainedMax: 10,
        },
        message:
          'Muitas alterações de assinatura foram solicitadas. Tente novamente mais tarde.',
      });

      const stateSnapshot = await db
        .collection(PLATFORM_SUBSCRIPTION_STATE_COLLECTION)
        .doc(uid)
        .get();
      const state = stateSnapshot.exists
        ? stateSnapshot.data() as PlatformRecurringSubscriptionStateDoc
        : null;

      if (!state?.currentContractId) {
        throw new HttpsError(
          'failed-precondition',
          'Não existe uma recorrência atual com redução agendada.',
          { reason: 'recurring_plan_change_not_scheduled' }
        );
      }

      const requested = await requestCancelRecurringPlanDowngrade({
        contractId: state.currentContractId,
        buyerUid: uid,
      });

      const provider = new AsaasPaymentProvider({
        runtime: resolveAsaasApiRuntimeConfig(),
        apiKey: ASAAS_API_KEY.value(),
      });

      let providerUpdateStatus: 'applied' | 'pending' = 'applied';

      try {
        await revertPendingRecurringPlanChangeAtProvider({
          contractId: requested.id,
          provider,
        });
      } catch {
        providerUpdateStatus = 'pending';
      }

      return {
        canceled: true,
        providerUpdateStatus,
      };
    }
  );
