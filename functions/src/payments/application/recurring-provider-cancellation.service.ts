// functions/src/payments/application/recurring-provider-cancellation.service.ts
// -----------------------------------------------------------------------------
// RECURRING PROVIDER CANCELLATION
// -----------------------------------------------------------------------------
// Cancela recorrência externa sem retirar período já pago. Falhas são
// persistidas para retry; 404 é tratado como convergência já alcançada.
// -----------------------------------------------------------------------------

import { HttpsError } from 'firebase-functions/v2/https';

import { db } from '../../firebaseApp';
import type {
  PlatformRecurringSubscriptionDoc,
  PlatformRecurringSubscriptionStateDoc,
} from '../domain/platform-recurring-subscription.model';
import type {
  AsaasPaymentProvider,
} from '../infrastructure/providers/asaas.provider';
import {
  PLATFORM_SUBSCRIPTION_COLLECTION,
  PLATFORM_SUBSCRIPTION_STATE_COLLECTION,
} from './platform-recurring-subscription.service';
import {
  assertRecurringContractBuyer,
} from './recurring-contract-authority.policy';

const MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1_000;

function retryDelayMs(attemptCount: number): number {
  const exponent = Math.max(0, Math.min(10, attemptCount - 1));
  return Math.min(5 * 60 * 1_000 * (2 ** exponent), MAX_RETRY_DELAY_MS);
}

function errorCode(error: unknown): string {
  if (error instanceof HttpsError) return error.code;
  if (error instanceof Error && error.name) return error.name.slice(0, 120);
  return 'provider-cancellation-failed';
}

export async function cancelRecurringContractAtProvider(input: {
  contractId: string;
  provider: AsaasPaymentProvider;
  reason: string;
}): Promise<{
  canceled: boolean;
  alreadyGone: boolean;
}> {
  const contractRef = db
    .collection(PLATFORM_SUBSCRIPTION_COLLECTION)
    .doc(input.contractId);
  const snapshot = await contractRef.get();

  if (!snapshot.exists) {
    return { canceled: false, alreadyGone: true };
  }

  const contract = snapshot.data() as PlatformRecurringSubscriptionDoc;
  const now = Date.now();

  if (!contract.renewalEnabled && !contract.needsProviderCancellation) {
    return { canceled: false, alreadyGone: false };
  }

  let alreadyGone = false;

  try {
    await input.provider.cancelRecurringSubscription(
      contract.providerSubscriptionId
    );
  } catch (error: unknown) {
    if (error instanceof HttpsError && error.code === 'not-found') {
      alreadyGone = true;
    } else {
      const nextAttemptCount =
        Math.max(0, contract.providerCancellationAttemptCount ?? 0) + 1;

      await contractRef.set(
        {
          needsProviderCancellation: true,
          providerCancellationAttemptCount: nextAttemptCount,
          providerCancellationNextAttemptAt:
            now + retryDelayMs(nextAttemptCount),
          providerCancellationLastErrorCode: errorCode(error),
          updatedAt: now,
        },
        { merge: true }
      );

      throw error;
    }
  }

  const stateRef = db
    .collection(PLATFORM_SUBSCRIPTION_STATE_COLLECTION)
    .doc(contract.buyerUid);

  await db.runTransaction(async (tx) => {
    const [freshContractSnapshot, stateSnapshot] = await Promise.all([
      tx.get(contractRef),
      tx.get(stateRef),
    ]);

    if (!freshContractSnapshot.exists) return;

    const fresh =
      freshContractSnapshot.data() as PlatformRecurringSubscriptionDoc;
    const state = stateSnapshot.exists
      ? stateSnapshot.data() as PlatformRecurringSubscriptionStateDoc
      : null;

    tx.set(
      contractRef,
      {
        renewalEnabled: false,
        needsProviderCancellation: false,
        providerCancellationAttemptCount:
          fresh.providerCancellationAttemptCount ?? 0,
        providerCancellationNextAttemptAt: null,
        providerCancellationLastErrorCode: null,
        canceledAt: fresh.canceledAt ?? now,
        updatedAt: now,
      },
      { merge: true }
    );

    if (state?.currentContractId === input.contractId) {
      tx.set(
        stateRef,
        {
          renewalEnabled: false,
          updatedAt: now,
        },
        { merge: true }
      );
    }

    tx.set(db.collection('billing_audit').doc(), {
      action: 'cancel_recurring_subscription_at_provider',
      buyerUid: fresh.buyerUid,
      contractId: input.contractId,
      providerSubscriptionId: fresh.providerSubscriptionId,
      reason: input.reason.slice(0, 120),
      alreadyGone,
      accessRevoked: false,
      createdAt: now,
    });
  });

  return {
    canceled: !alreadyGone,
    alreadyGone,
  };
}


export async function requestRecurringContractCancellation(input: {
  contractId: string;
  reason: string;
  expectedBuyerUid?: string;
}): Promise<PlatformRecurringSubscriptionDoc | null> {
  const contractRef = db
    .collection(PLATFORM_SUBSCRIPTION_COLLECTION)
    .doc(input.contractId);
  let result: PlatformRecurringSubscriptionDoc | null = null;
  const now = Date.now();

  await db.runTransaction(async (tx) => {
    const contractSnapshot = await tx.get(contractRef);
    if (!contractSnapshot.exists) return;

    const contract =
      contractSnapshot.data() as PlatformRecurringSubscriptionDoc;

    if (input.expectedBuyerUid) {
      assertRecurringContractBuyer(
        contract.buyerUid,
        input.expectedBuyerUid
      );
    }

    const stateRef = db
      .collection(PLATFORM_SUBSCRIPTION_STATE_COLLECTION)
      .doc(contract.buyerUid);
    const stateSnapshot = await tx.get(stateRef);
    const state = stateSnapshot.exists
      ? stateSnapshot.data() as PlatformRecurringSubscriptionStateDoc
      : null;

    tx.set(
      contractRef,
      {
        renewalEnabled: false,
        needsProviderCancellation: true,
        providerCancellationNextAttemptAt: now,
        updatedAt: now,
      },
      { merge: true }
    );

    if (state?.currentContractId === input.contractId) {
      tx.set(
        stateRef,
        {
          renewalEnabled: false,
          updatedAt: now,
        },
        { merge: true }
      );
    }

    tx.set(db.collection('billing_audit').doc(), {
      action: 'request_recurring_subscription_cancellation',
      buyerUid: contract.buyerUid,
      contractId: input.contractId,
      providerSubscriptionId: contract.providerSubscriptionId,
      reason: input.reason.slice(0, 120),
      accessRevoked: false,
      createdAt: now,
    });

    result = {
      ...contract,
      renewalEnabled: false,
      needsProviderCancellation: true,
      providerCancellationNextAttemptAt: now,
      updatedAt: now,
    };
  });

  return result;
}
