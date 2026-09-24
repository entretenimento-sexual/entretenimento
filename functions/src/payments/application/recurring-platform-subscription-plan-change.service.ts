// functions/src/payments/application/recurring-platform-subscription-plan-change.service.ts
// -----------------------------------------------------------------------------
// RECURRING PLATFORM SUBSCRIPTION PLAN CHANGE
// -----------------------------------------------------------------------------
// Persiste primeiro a intenção de downgrade e converge o valor da recorrência
// no provider. O entitlement vigente não é alterado aqui.
// -----------------------------------------------------------------------------

import { HttpsError } from 'firebase-functions/v2/https';

import { db } from '../../firebaseApp';
import type {
  BillingPlanSnapshot,
} from '../domain/billing.model';
import type {
  PlatformRecurringPendingPlanChange,
  PlatformRecurringSubscriptionDoc,
} from '../domain/platform-recurring-subscription.model';
import type {
  AsaasPaymentProvider,
} from '../infrastructure/providers/asaas.provider';
import {
  PLATFORM_SUBSCRIPTION_COLLECTION,
} from './platform-recurring-subscription.service';

const MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1_000;

function retryDelayMs(attemptCount: number): number {
  const exponent = Math.max(0, Math.min(10, attemptCount - 1));
  return Math.min(5 * 60 * 1_000 * (2 ** exponent), MAX_RETRY_DELAY_MS);
}

function errorCode(error: unknown): string {
  if (error instanceof HttpsError) return error.code;
  if (error instanceof Error && error.name) return error.name.slice(0, 120);
  return 'provider-plan-change-failed';
}

export async function requestRecurringPlanDowngrade(input: {
  contractId: string;
  buyerUid: string;
  targetPlan: BillingPlanSnapshot;
  effectiveAt: number;
}): Promise<PlatformRecurringSubscriptionDoc> {
  const contractRef = db
    .collection(PLATFORM_SUBSCRIPTION_COLLECTION)
    .doc(input.contractId);
  const now = Date.now();
  let result!: PlatformRecurringSubscriptionDoc;

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(contractRef);

    if (!snapshot.exists) {
      throw new HttpsError(
        'failed-precondition',
        'A assinatura recorrente atual não foi localizada.'
      );
    }

    const contract = snapshot.data() as PlatformRecurringSubscriptionDoc;

    if (
      contract.buyerUid !== input.buyerUid
      || contract.provider !== 'asaas'
      || contract.status !== 'active'
      || contract.renewalEnabled !== true
      || contract.isCurrent !== true
      || contract.needsProviderCancellation === true
    ) {
      throw new HttpsError(
        'failed-precondition',
        'A assinatura atual não pode receber uma redução de plano agora.',
        { reason: 'recurring_plan_change_unavailable' }
      );
    }

    const existing = contract.pendingPlanChange ?? null;
    if (
      existing
      && existing.planKey === input.targetPlan.key
      && existing.amountCents === input.targetPlan.amountCents
      && existing.effectiveAt === input.effectiveAt
    ) {
      result = contract;
      return;
    }

    if (existing) {
      throw new HttpsError(
        'failed-precondition',
        'Já existe uma mudança de plano aguardando o próximo ciclo.',
        { reason: 'recurring_plan_change_already_scheduled' }
      );
    }

    const pendingPlanChange: PlatformRecurringPendingPlanChange = {
      planId: input.targetPlan.id,
      planKey: input.targetPlan.key,
      grantedRole: input.targetPlan.grantedRole,
      planSnapshot: input.targetPlan,
      amountCents: input.targetPlan.amountCents,
      currency: input.targetPlan.currency,
      effectiveAt: input.effectiveAt,
      requestedAt: now,
      providerUpdateStatus: 'pending',
      providerUpdateAttemptCount: 0,
      providerUpdateNextAttemptAt: now,
      providerUpdateLastErrorCode: null,
      providerUpdatedAt: null,
    };

    tx.set(
      contractRef,
      {
        pendingPlanChange,
        needsProviderPlanChangeSync: true,
        updatedAt: now,
      },
      { merge: true }
    );

    tx.set(db.collection('billing_audit').doc(), {
      action: 'schedule_recurring_subscription_downgrade',
      buyerUid: contract.buyerUid,
      contractId: contract.id,
      providerSubscriptionId: contract.providerSubscriptionId,
      fromPlanKey: contract.planKey,
      toPlanKey: input.targetPlan.key,
      currentAmountCents: contract.amountCents,
      targetAmountCents: input.targetPlan.amountCents,
      effectiveAt: input.effectiveAt,
      accessChanged: false,
      createdAt: now,
    });

    result = {
      ...contract,
      pendingPlanChange,
      updatedAt: now,
    };
  });

  return result;
}

export async function applyPendingRecurringPlanChangeAtProvider(input: {
  contractId: string;
  provider: AsaasPaymentProvider;
}): Promise<{
  applied: boolean;
  alreadyApplied: boolean;
}> {
  const contractRef = db
    .collection(PLATFORM_SUBSCRIPTION_COLLECTION)
    .doc(input.contractId);
  const snapshot = await contractRef.get();

  if (!snapshot.exists) {
    return { applied: false, alreadyApplied: false };
  }

  const contract = snapshot.data() as PlatformRecurringSubscriptionDoc;
  const pending = contract.pendingPlanChange ?? null;

  if (!pending) {
    return { applied: false, alreadyApplied: false };
  }

  if (pending.providerUpdateStatus === 'applied') {
    return { applied: false, alreadyApplied: true };
  }

  if (
    contract.status !== 'active'
    || contract.renewalEnabled !== true
    || contract.needsProviderCancellation === true
  ) {
    throw new HttpsError(
      'failed-precondition',
      'A recorrência deixou de ser elegível para alteração de plano.',
      { reason: 'recurring_plan_change_unavailable' }
    );
  }

  const now = Date.now();

  try {
    await input.provider.updateRecurringSubscriptionAmount({
      providerSubscriptionId: contract.providerSubscriptionId,
      amountCents: pending.amountCents,
      // Garante convergência caso a cobrança do próximo ciclo já tenha sido
      // gerada. O fluxo só agenda downgrade em contrato ativo e adimplente.
      updatePendingPayments: true,
    });
  } catch (error: unknown) {
    const attemptCount =
      Math.max(0, pending.providerUpdateAttemptCount ?? 0) + 1;

    await contractRef.set(
      {
        pendingPlanChange: {
          ...pending,
          providerUpdateStatus: 'retry',
          providerUpdateAttemptCount: attemptCount,
          providerUpdateNextAttemptAt:
            now + retryDelayMs(attemptCount),
          providerUpdateLastErrorCode: errorCode(error),
        },
        needsProviderPlanChangeSync: true,
        updatedAt: now,
      },
      { merge: true }
    );

    throw error;
  }

  await db.runTransaction(async (tx) => {
    const freshSnapshot = await tx.get(contractRef);
    if (!freshSnapshot.exists) return;

    const fresh = freshSnapshot.data() as PlatformRecurringSubscriptionDoc;
    const freshPending = fresh.pendingPlanChange ?? null;

    if (!freshPending) return;

    tx.set(
      contractRef,
      {
        pendingPlanChange: {
          ...freshPending,
          providerUpdateStatus: 'applied',
          providerUpdateAttemptCount:
            freshPending.providerUpdateAttemptCount ?? 0,
          providerUpdateNextAttemptAt: null,
          providerUpdateLastErrorCode: null,
          providerUpdatedAt: now,
        },
        needsProviderPlanChangeSync: false,
        updatedAt: now,
      },
      { merge: true }
    );

    tx.set(db.collection('billing_audit').doc(), {
      action: 'apply_recurring_subscription_downgrade_at_provider',
      buyerUid: fresh.buyerUid,
      contractId: fresh.id,
      providerSubscriptionId: fresh.providerSubscriptionId,
      targetPlanKey: freshPending.planKey,
      targetAmountCents: freshPending.amountCents,
      effectiveAt: freshPending.effectiveAt,
      updatePendingPayments: true,
      accessChanged: false,
      createdAt: now,
    });
  });

  return { applied: true, alreadyApplied: false };
}


export async function requestCancelRecurringPlanDowngrade(input: {
  contractId: string;
  buyerUid: string;
}): Promise<PlatformRecurringSubscriptionDoc> {
  const contractRef = db
    .collection(PLATFORM_SUBSCRIPTION_COLLECTION)
    .doc(input.contractId);
  const now = Date.now();
  let result!: PlatformRecurringSubscriptionDoc;

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(contractRef);

    if (!snapshot.exists) {
      throw new HttpsError(
        'failed-precondition',
        'A assinatura recorrente atual não foi localizada.'
      );
    }

    const contract = snapshot.data() as PlatformRecurringSubscriptionDoc;
    const pending = contract.pendingPlanChange ?? null;

    if (
      contract.buyerUid !== input.buyerUid
      || !pending
      || contract.status !== 'active'
      || contract.renewalEnabled !== true
      || contract.isCurrent !== true
      || contract.needsProviderCancellation === true
    ) {
      throw new HttpsError(
        'failed-precondition',
        'Não existe uma redução de plano cancelável nesta assinatura.',
        { reason: 'recurring_plan_change_not_scheduled' }
      );
    }

    if (pending.cancellationRequestedAt) {
      result = contract;
      return;
    }

    const nextPending: PlatformRecurringPendingPlanChange = {
      ...pending,
      cancellationRequestedAt: now,
      providerRevertAttemptCount: 0,
      providerRevertNextAttemptAt: now,
      providerRevertLastErrorCode: null,
    };

    tx.set(
      contractRef,
      {
        pendingPlanChange: nextPending,
        needsProviderPlanChangeSync: true,
        updatedAt: now,
      },
      { merge: true }
    );

    tx.set(db.collection('billing_audit').doc(), {
      action: 'request_cancel_recurring_subscription_downgrade',
      buyerUid: contract.buyerUid,
      contractId: contract.id,
      providerSubscriptionId: contract.providerSubscriptionId,
      scheduledPlanKey: pending.planKey,
      effectiveAt: pending.effectiveAt,
      accessChanged: false,
      createdAt: now,
    });

    result = {
      ...contract,
      pendingPlanChange: nextPending,
      needsProviderPlanChangeSync: true,
      updatedAt: now,
    };
  });

  return result;
}

export async function revertPendingRecurringPlanChangeAtProvider(input: {
  contractId: string;
  provider: AsaasPaymentProvider;
}): Promise<{
  reverted: boolean;
  alreadyClear: boolean;
}> {
  const contractRef = db
    .collection(PLATFORM_SUBSCRIPTION_COLLECTION)
    .doc(input.contractId);
  const snapshot = await contractRef.get();

  if (!snapshot.exists) {
    return { reverted: false, alreadyClear: true };
  }

  const contract = snapshot.data() as PlatformRecurringSubscriptionDoc;
  const pending = contract.pendingPlanChange ?? null;

  if (!pending) {
    return { reverted: false, alreadyClear: true };
  }

  if (!pending.cancellationRequestedAt) {
    throw new HttpsError(
      'failed-precondition',
      'A alteração de plano não está em cancelamento.',
      { reason: 'recurring_plan_change_cancel_not_requested' }
    );
  }

  const now = Date.now();

  try {
    await input.provider.updateRecurringSubscriptionAmount({
      providerSubscriptionId: contract.providerSubscriptionId,
      amountCents: contract.amountCents,
      updatePendingPayments: true,
    });
  } catch (error: unknown) {
    const attemptCount =
      Math.max(0, pending.providerRevertAttemptCount ?? 0) + 1;

    await contractRef.set(
      {
        pendingPlanChange: {
          ...pending,
          providerRevertAttemptCount: attemptCount,
          providerRevertNextAttemptAt:
            now + retryDelayMs(attemptCount),
          providerRevertLastErrorCode: errorCode(error),
        },
        needsProviderPlanChangeSync: true,
        updatedAt: now,
      },
      { merge: true }
    );

    throw error;
  }

  await db.runTransaction(async (tx) => {
    const freshSnapshot = await tx.get(contractRef);
    if (!freshSnapshot.exists) return;

    const fresh = freshSnapshot.data() as PlatformRecurringSubscriptionDoc;
    const freshPending = fresh.pendingPlanChange ?? null;

    if (!freshPending?.cancellationRequestedAt) return;

    tx.set(
      contractRef,
      {
        pendingPlanChange: null,
        needsProviderPlanChangeSync: false,
        updatedAt: now,
      },
      { merge: true }
    );

    tx.set(db.collection('billing_audit').doc(), {
      action: 'cancel_recurring_subscription_downgrade',
      buyerUid: fresh.buyerUid,
      contractId: fresh.id,
      providerSubscriptionId: fresh.providerSubscriptionId,
      restoredPlanKey: fresh.planKey,
      restoredAmountCents: fresh.amountCents,
      accessChanged: false,
      createdAt: now,
    });
  });

  return { reverted: true, alreadyClear: false };
}
