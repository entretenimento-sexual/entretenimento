// functions/src/payments/application/provider-webhook-processor.service.ts
// -----------------------------------------------------------------------------
// PROVIDER WEBHOOK PROCESSOR
// -----------------------------------------------------------------------------
// Claim transacional + processamento idempotente do inbox. Eventos que chegam
// fora de ordem são reprogramados com backoff; erros de contrato ficam
// terminalmente marcados para não gerar loop infinito no webhook público.
// -----------------------------------------------------------------------------

import { db } from '../../firebaseApp';
import type {
  ProviderWebhookEventDoc,
  VerifiedProviderWebhookEvent,
} from '../domain/provider-webhook.model';
import type {
  AsaasPaymentProvider,
} from '../infrastructure/providers/asaas.provider';
import {
  PROVIDER_WEBHOOK_EVENT_COLLECTION,
} from './provider-webhook-inbox.service';
import {
  applyAsaasCheckoutLifecycleEvent,
  applyAsaasSubscriptionLifecycleEvent,
  markRecurringSubscriptionPaymentProblem,
  RetryableProviderWebhookError,
  buildRecurringSubscriptionContractId,
} from './platform-recurring-subscription.service';
import {
  settleRecurringPlatformSubscriptionPayment,
} from './recurring-platform-subscription-settlement.service';
import {
  reverseRecurringPlatformSubscriptionPayment,
} from './recurring-platform-subscription-reversal.service';
import {
  cancelRecurringContractAtProvider,
} from './recurring-provider-cancellation.service';

const PROCESSING_LEASE_MS = 5 * 60 * 1_000;
const MAX_RETRY_DELAY_MS = 6 * 60 * 60 * 1_000;
const MAX_RETRY_ATTEMPTS = 20;

function retryDelayMs(attemptCount: number): number {
  const exponent = Math.max(0, Math.min(8, attemptCount - 1));
  return Math.min(30_000 * (2 ** exponent), MAX_RETRY_DELAY_MS);
}

function safeErrorCode(error: unknown): string {
  if (error instanceof RetryableProviderWebhookError) {
    return error.code.slice(0, 120);
  }

  const source = error as { code?: unknown; name?: unknown };
  return String(
    source?.code ?? source?.name ?? 'provider-webhook-processing-failed'
  ).slice(0, 120);
}

async function claimEvent(
  eventId: string,
  now: number
): Promise<ProviderWebhookEventDoc | null> {
  const ref = db
    .collection(PROVIDER_WEBHOOK_EVENT_COLLECTION)
    .doc(eventId);
  let claimed: ProviderWebhookEventDoc | null = null;

  await db.runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    if (!snapshot.exists) return;

    const current = snapshot.data() as ProviderWebhookEventDoc;

    if (
      current.processingStatus === 'processed' ||
      current.processingStatus === 'ignored' ||
      current.processingStatus === 'failed'
    ) {
      return;
    }

    if (
      current.processingStatus === 'processing' &&
      typeof current.lastAttemptAt === 'number' &&
      current.lastAttemptAt + PROCESSING_LEASE_MS > now
    ) {
      return;
    }

    if (
      current.processingStatus === 'retry' &&
      typeof current.nextAttemptAt === 'number' &&
      current.nextAttemptAt > now
    ) {
      return;
    }

    const attemptCount = Math.max(0, current.attemptCount ?? 0) + 1;

    tx.set(
      ref,
      {
        processingStatus: 'processing',
        attemptCount,
        lastAttemptAt: now,
        nextAttemptAt: null,
        lastErrorCode: null,
        updatedAt: now,
      },
      { merge: true }
    );

    claimed = {
      ...current,
      processingStatus: 'processing',
      attemptCount,
      lastAttemptAt: now,
      nextAttemptAt: null,
      lastErrorCode: null,
      updatedAt: now,
    };
  });

  return claimed;
}

async function completeEvent(
  eventId: string,
  status: 'processed' | 'ignored',
  now: number
): Promise<void> {
  await db
    .collection(PROVIDER_WEBHOOK_EVENT_COLLECTION)
    .doc(eventId)
    .set(
      {
        processingStatus: status,
        processedAt: now,
        nextAttemptAt: null,
        lastErrorCode: null,
        updatedAt: now,
      },
      { merge: true }
    );
}

async function failEvent(
  event: ProviderWebhookEventDoc,
  error: unknown,
  now: number
): Promise<void> {
  const retryable = error instanceof RetryableProviderWebhookError;
  const exhausted = event.attemptCount >= MAX_RETRY_ATTEMPTS;
  const status = retryable && !exhausted ? 'retry' : 'failed';

  await db
    .collection(PROVIDER_WEBHOOK_EVENT_COLLECTION)
    .doc(event.id)
    .set(
      {
        processingStatus: status,
        nextAttemptAt:
          status === 'retry'
            ? now + retryDelayMs(event.attemptCount)
            : null,
        lastErrorCode: safeErrorCode(error),
        processedAt: status === 'failed' ? now : null,
        updatedAt: now,
      },
      { merge: true }
    );

  if (status === 'failed') {
    await db.collection('billing_audit').add({
      action: 'provider_webhook_processing_failed',
      provider: event.provider,
      providerEventId: event.providerEventId,
      providerEventName: event.eventName,
      webhookDocumentId: event.id,
      attemptCount: event.attemptCount,
      errorCode: safeErrorCode(error),
      createdAt: now,
    });
  }
}

async function processAsaasEvent(
  event: VerifiedProviderWebhookEvent,
  provider: AsaasPaymentProvider
): Promise<'processed' | 'ignored'> {
  if (event.eventName.startsWith('CHECKOUT_')) {
    return applyAsaasCheckoutLifecycleEvent(event);
  }

  if (event.eventName.startsWith('SUBSCRIPTION_')) {
    return applyAsaasSubscriptionLifecycleEvent(event);
  }

  if (
    event.eventName === 'PAYMENT_CONFIRMED' ||
    event.eventName === 'PAYMENT_RECEIVED'
  ) {
    const settlement =
      await settleRecurringPlatformSubscriptionPayment(event);

    if (
      settlement.supersededContractId &&
      settlement.supersededProviderSubscriptionId
    ) {
      await cancelRecurringContractAtProvider({
        contractId: settlement.supersededContractId,
        provider,
        reason: 'plan-replacement',
      }).catch(() => undefined);
    }

    return 'processed';
  }

  if (
    event.eventName === 'PAYMENT_OVERDUE' ||
    event.eventName === 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED'
  ) {
    await markRecurringSubscriptionPaymentProblem(event);
    return 'processed';
  }

  if (
    event.eventName === 'PAYMENT_REFUNDED' ||
    event.eventName === 'PAYMENT_CHARGEBACK_REQUESTED'
  ) {
    const reversal =
      await reverseRecurringPlatformSubscriptionPayment(event);

    if (
      reversal.providerCancellationRequired &&
      event.subscriptionId
    ) {
      await cancelRecurringContractAtProvider({
        contractId: buildRecurringSubscriptionContractId(
          event.subscriptionId
        ),
        provider,
        reason: 'chargeback',
      }).catch(() => undefined);
    }

    return 'processed';
  }

  return 'ignored';
}

export async function processProviderWebhookEventById(input: {
  eventId: string;
  provider: AsaasPaymentProvider;
}): Promise<{
  claimed: boolean;
  status: 'processed' | 'ignored' | 'retry' | 'failed' | 'skipped';
}> {
  const now = Date.now();
  const event = await claimEvent(input.eventId, now);

  if (!event) {
    return { claimed: false, status: 'skipped' };
  }

  try {
    const status = await processAsaasEvent(event, input.provider);
    await completeEvent(event.id, status, Date.now());
    return { claimed: true, status };
  } catch (error: unknown) {
    await failEvent(event, error, Date.now());

    return {
      claimed: true,
      status:
        error instanceof RetryableProviderWebhookError &&
        event.attemptCount < MAX_RETRY_ATTEMPTS
          ? 'retry'
          : 'failed',
    };
  }
}
