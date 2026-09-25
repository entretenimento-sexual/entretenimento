// functions/src/payments/application/schedule-platform-subscription-downgrade.handler.ts
// -----------------------------------------------------------------------------
// SCHEDULE PLATFORM SUBSCRIPTION DOWNGRADE
// -----------------------------------------------------------------------------
// Agenda redução para o próximo ciclo sem retirar benefício já pago.
// A intenção é persistida antes da chamada externa; falha do provider entra em retry.
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
  PlatformRole,
} from '../domain/billing.model';
import type {
  PlatformRecurringSubscriptionDoc,
  PlatformRecurringSubscriptionStateDoc,
} from '../domain/platform-recurring-subscription.model';
import {
  AsaasPaymentProvider,
} from '../infrastructure/providers/asaas.provider';
import {
  createBillingPlanSnapshot,
  requirePlatformPlanByKey,
} from './billing-plan-catalog.service';
import {
  getActivePlatformSubscriptionEntitlement,
} from './platform-subscription-entitlement.service';
import {
  PLATFORM_SUBSCRIPTION_COLLECTION,
  PLATFORM_SUBSCRIPTION_STATE_COLLECTION,
} from './platform-recurring-subscription.service';
import {
  applyPendingRecurringPlanChangeAtProvider,
  requestRecurringPlanDowngrade,
} from './recurring-platform-subscription-plan-change.service';

interface ScheduleDowngradeRequest {
  planKey?: unknown;
  planId?: unknown;
  expectedAmountCents?: unknown;
  expectedCurrency?: unknown;
  expectedInterval?: unknown;
  expectedCatalogVersion?: unknown;
}

interface ScheduleDowngradeResponse {
  scheduled: true;
  planKey: string;
  effectiveAt: number;
  providerUpdateStatus: 'applied' | 'pending';
}

const ROLE_RANK: Readonly<Record<PlatformRole, number>> = Object.freeze({
  basic: 1,
  premium: 2,
  vip: 3,
});

function assertQuoteMatches(
  plan: ReturnType<typeof requirePlatformPlanByKey>,
  input: ScheduleDowngradeRequest | undefined
): void {
  const valid =
    typeof input?.expectedAmountCents === 'number'
    && Number.isInteger(input.expectedAmountCents)
    && input.expectedAmountCents === plan.amountCents
    && input.expectedCurrency === plan.currency
    && input.expectedInterval === plan.interval
    && input.expectedCatalogVersion === plan.catalogVersion;

  if (!valid) {
    throw new HttpsError(
      'failed-precondition',
      'O valor do plano mudou. Recarregue os planos antes de agendar a redução.',
      {
        reason: 'plan_quote_changed',
        planKey: plan.key,
        catalogVersion: plan.catalogVersion,
      }
    );
  }
}

export const schedulePlatformSubscriptionDowngrade =
  onCall<ScheduleDowngradeRequest>(
    {
      region: FUNCTIONS_REGION,
      secrets: [ASAAS_API_KEY],
    },
    async (request): Promise<ScheduleDowngradeResponse> => {
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
        action: 'billing:schedule-platform-downgrade',
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

      const plan = requirePlatformPlanByKey(
        request.data?.planKey,
        request.data?.planId
      );
      assertQuoteMatches(plan, request.data);

      const [entitlement, stateSnapshot] = await Promise.all([
        getActivePlatformSubscriptionEntitlement(uid),
        db
          .collection(PLATFORM_SUBSCRIPTION_STATE_COLLECTION)
          .doc(uid)
          .get(),
      ]);
      const state = stateSnapshot.exists
        ? stateSnapshot.data() as PlatformRecurringSubscriptionStateDoc
        : null;

      if (
        !entitlement.active
        || !entitlement.role
        || entitlement.endsAt === null
        || ROLE_RANK[plan.grantedRole] >= ROLE_RANK[entitlement.role]
      ) {
        throw new HttpsError(
          'failed-precondition',
          'Selecione um plano inferior ao plano atualmente ativo.',
          { reason: 'downgrade_requires_lower_plan' }
        );
      }

      if (!state?.currentContractId || state.renewalEnabled !== true) {
        throw new HttpsError(
          'failed-precondition',
          'A renovação recorrente atual não está disponível para alteração.',
          { reason: 'recurring_plan_change_unavailable' }
        );
      }

      const contractSnapshot = await db
        .collection(PLATFORM_SUBSCRIPTION_COLLECTION)
        .doc(state.currentContractId)
        .get();
      const contract = contractSnapshot.exists
        ? contractSnapshot.data() as PlatformRecurringSubscriptionDoc
        : null;

      if (
        !contract
        || contract.buyerUid !== uid
        || contract.isCurrent !== true
        || contract.renewalEnabled !== true
      ) {
        throw new HttpsError(
          'failed-precondition',
          'A assinatura recorrente atual está inconsistente.',
          { reason: 'recurring_plan_change_unavailable' }
        );
      }

      const targetPlan = createBillingPlanSnapshot(plan, Date.now());
      const scheduled = await requestRecurringPlanDowngrade({
        contractId: contract.id,
        buyerUid: uid,
        targetPlan,
        effectiveAt: entitlement.endsAt,
      });

      const pending = scheduled.pendingPlanChange;
      if (!pending) {
        throw new HttpsError(
          'internal',
          'A alteração de plano não pôde ser registrada.'
        );
      }

      const provider = new AsaasPaymentProvider({
        runtime: resolveAsaasApiRuntimeConfig(),
        apiKey: ASAAS_API_KEY.value(),
      });

      let providerUpdateStatus: 'applied' | 'pending' = 'applied';

      try {
        await applyPendingRecurringPlanChangeAtProvider({
          contractId: contract.id,
          provider,
        });
      } catch {
        providerUpdateStatus = 'pending';
      }

      return {
        scheduled: true,
        planKey: pending.planKey,
        effectiveAt: pending.effectiveAt,
        providerUpdateStatus,
      };
    }
  );
