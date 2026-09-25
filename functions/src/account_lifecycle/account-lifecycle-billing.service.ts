// functions/src/account_lifecycle/account-lifecycle-billing.service.ts
// -----------------------------------------------------------------------------
// ACCOUNT LIFECYCLE BILLING COORDINATION
// -----------------------------------------------------------------------------
// Lifecycle persiste primeiro uma obrigação de interromper cobranças futuras.
// Este bridge converge a obrigação com billing; falha financeira posterior não
// desfaz uma suspensão/exclusão de conta já confirmada.
// -----------------------------------------------------------------------------

import { db } from '../firebaseApp';
import {
  ASAAS_API_KEY,
  resolveAsaasApiRuntimeConfig,
} from '../payments/config/asaas.config';
import {
  PLATFORM_SUBSCRIPTION_STATE_COLLECTION,
} from '../payments/application/platform-recurring-subscription.service';
import {
  cancelRecurringContractAtProvider,
  requestRecurringContractCancellation,
} from '../payments/application/recurring-provider-cancellation.service';
import {
  AsaasPaymentProvider,
} from '../payments/infrastructure/providers/asaas.provider';
import type { UserDoc } from './_shared';

export type AccountLifecycleSubscriptionRenewalStatus =
  | 'active'
  | 'canceled'
  | 'pending'
  | 'none';

export interface AccountLifecycleBillingCancellationResult {
  recurringConfigured: boolean;
  cancellationRequested: boolean;
  providerCancellationStatus:
    | 'not_configured'
    | 'completed'
    | 'pending';
}

function safeErrorCode(error: unknown): string {
  const source = error as { code?: unknown; name?: unknown };
  return String(
    source?.code ?? source?.name ?? 'account-lifecycle-billing-failed'
  ).slice(0, 120);
}

export function buildAccountLifecycleBillingCancellationPatch(input: {
  reason: string;
  now: number;
}): Pick<
  UserDoc,
  | 'billingCancellationPending'
  | 'billingCancellationReason'
  | 'billingCancellationRequestedAt'
  | 'billingCancellationLastAttemptAt'
  | 'billingCancellationLastErrorCode'
> {
  return {
    billingCancellationPending: true,
    billingCancellationReason: input.reason.slice(0, 120),
    billingCancellationRequestedAt: input.now,
    billingCancellationLastAttemptAt: null,
    billingCancellationLastErrorCode: null,
  };
}

export async function getAccountLifecycleSubscriptionRenewalStatus(
  uid: string
): Promise<AccountLifecycleSubscriptionRenewalStatus> {
  try {
    const [userSnapshot, stateSnapshot] = await Promise.all([
      db.collection('users').doc(uid).get(),
      db.collection(PLATFORM_SUBSCRIPTION_STATE_COLLECTION).doc(uid).get(),
    ]);
    const user = userSnapshot.exists
      ? userSnapshot.data() as UserDoc
      : null;
    const state = stateSnapshot.exists ? stateSnapshot.data() ?? {} : null;

    if (user?.billingCancellationPending === true) return 'pending';
    if (!state?.['currentContractId']) return 'none';
    return state['renewalEnabled'] === true ? 'active' : 'canceled';
  } catch {
    // A conta já pode ter sido reativada/restaurada. Uma falha de leitura
    // financeira posterior não transforma essa mutação em falso erro.
    return 'pending';
  }
}

export async function reconcileAccountLifecycleBillingCancellation(input: {
  uid: string;
  fallbackReason?: string;
}): Promise<AccountLifecycleBillingCancellationResult> {
  const userRef = db.collection('users').doc(input.uid);
  const userSnapshot = await userRef.get();
  const user = userSnapshot.exists
    ? userSnapshot.data() as UserDoc
    : null;

  if (!user || user.billingCancellationPending !== true) {
    return {
      recurringConfigured: false,
      cancellationRequested: false,
      providerCancellationStatus: 'not_configured',
    };
  }

  const reason = String(
    user.billingCancellationReason
      ?? input.fallbackReason
      ?? 'account-lifecycle'
  ).trim().slice(0, 120) || 'account-lifecycle';
  const now = Date.now();

  try {
    const stateSnapshot = await db
      .collection(PLATFORM_SUBSCRIPTION_STATE_COLLECTION)
      .doc(input.uid)
      .get();
    const currentContractId = String(
      stateSnapshot.data()?.['currentContractId'] ?? ''
    ).trim();

    if (!currentContractId) {
      await userRef.set(
        {
          billingCancellationPending: false,
          billingCancellationLastAttemptAt: now,
          billingCancellationLastErrorCode: null,
        },
        { merge: true }
      );

      return {
        recurringConfigured: false,
        cancellationRequested: false,
        providerCancellationStatus: 'not_configured',
      };
    }

    const requested = await requestRecurringContractCancellation({
      contractId: currentContractId,
      reason,
    });

    if (!requested) {
      throw Object.assign(
        new Error('Recurring contract could not be resolved.'),
        { code: 'billing/recurring-contract-unresolved' }
      );
    }

    let providerCancellationStatus: 'completed' | 'pending' = 'completed';

    try {
      const provider = new AsaasPaymentProvider({
        runtime: resolveAsaasApiRuntimeConfig(),
        apiKey: ASAAS_API_KEY.value(),
      });

      await cancelRecurringContractAtProvider({
        contractId: currentContractId,
        provider,
        reason,
      });
    } catch {
      // O contrato já carrega needsProviderCancellation. O reconciliador do
      // domínio financeiro assume daqui em diante a convergência externa.
      providerCancellationStatus = 'pending';
    }

    await userRef.set(
      {
        billingCancellationPending: false,
        billingCancellationLastAttemptAt: now,
        billingCancellationLastErrorCode: null,
      },
      { merge: true }
    );

    return {
      recurringConfigured: true,
      cancellationRequested: true,
      providerCancellationStatus,
    };
  } catch (error: unknown) {
    await userRef.set(
      {
        billingCancellationPending: true,
        billingCancellationLastAttemptAt: now,
        billingCancellationLastErrorCode: safeErrorCode(error),
      },
      { merge: true }
    ).catch(() => undefined);

    return {
      recurringConfigured: true,
      cancellationRequested: false,
      providerCancellationStatus: 'pending',
    };
  }
}

/**
 * Compatibilidade para callers existentes. Ao ser usado fora de uma transação
 * de lifecycle, persiste a obrigação antes de tentar billing.
 */
export async function cancelRecurringBillingForAccountLifecycle(input: {
  uid: string;
  reason: string;
}): Promise<AccountLifecycleBillingCancellationResult> {
  const now = Date.now();

  await db.collection('users').doc(input.uid).set(
    buildAccountLifecycleBillingCancellationPatch({
      reason: input.reason,
      now,
    }),
    { merge: true }
  );

  return reconcileAccountLifecycleBillingCancellation({
    uid: input.uid,
    fallbackReason: input.reason,
  });
}
