// functions/src/account_lifecycle/account-lifecycle-billing.service.ts
// -----------------------------------------------------------------------------
// ACCOUNT LIFECYCLE BILLING COORDINATION
// -----------------------------------------------------------------------------
// Interrompe novas cobranças quando uma conta entra em exclusão. A intenção é
// persistida antes da chamada externa; indisponibilidade do provider não bloqueia
// o lifecycle e o reconciliador financeiro retoma a convergência.
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

export interface AccountLifecycleBillingCancellationResult {
  recurringConfigured: boolean;
  cancellationRequested: boolean;
  providerCancellationStatus:
    | 'not_configured'
    | 'completed'
    | 'pending';
}

export async function cancelRecurringBillingForAccountLifecycle(input: {
  uid: string;
  reason: string;
}): Promise<AccountLifecycleBillingCancellationResult> {
  const stateSnapshot = await db
    .collection(PLATFORM_SUBSCRIPTION_STATE_COLLECTION)
    .doc(input.uid)
    .get();
  const currentContractId = String(
    stateSnapshot.data()?.['currentContractId'] ?? ''
  ).trim();

  if (!currentContractId) {
    return {
      recurringConfigured: false,
      cancellationRequested: false,
      providerCancellationStatus: 'not_configured',
    };
  }

  const requestedCancellation =
    await requestRecurringContractCancellation({
      contractId: currentContractId,
      reason: input.reason,
    });

  if (!requestedCancellation) {
    return {
      recurringConfigured: true,
      cancellationRequested: false,
      providerCancellationStatus: 'pending',
    };
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
      reason: input.reason,
    });
  } catch {
    // A intenção já está persistida. O reconciliador financeiro conclui depois.
    providerCancellationStatus = 'pending';
  }

  return {
    recurringConfigured: true,
    cancellationRequested: true,
    providerCancellationStatus,
  };
}
