// functions/src/payments/application/process-provider-webhook.handler.ts
// -----------------------------------------------------------------------------
// ASYNC PROVIDER WEBHOOK PROCESSING
// -----------------------------------------------------------------------------
// Firestore trigger processa imediatamente; scheduler cobre retries, eventos
// fora de ordem e cancelamentos externos pendentes.
// -----------------------------------------------------------------------------

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  ASAAS_API_KEY,
  isAsaasSubscriptionUpdateEnabled,
  resolveAsaasApiRuntimeConfig,
} from '../config/asaas.config';
import {
  AsaasPaymentProvider,
} from '../infrastructure/providers/asaas.provider';
import {
  PROVIDER_WEBHOOK_EVENT_COLLECTION,
} from './provider-webhook-inbox.service';
import {
  processProviderWebhookEventById,
} from './provider-webhook-processor.service';
import {
  PLATFORM_SUBSCRIPTION_COLLECTION,
} from './platform-recurring-subscription.service';
import {
  cancelRecurringContractAtProvider,
} from './recurring-provider-cancellation.service';
import {
  applyPendingRecurringPlanChangeAtProvider,
  revertPendingRecurringPlanChangeAtProvider,
} from './recurring-platform-subscription-plan-change.service';
import type {
  PlatformRecurringSubscriptionDoc,
} from '../domain/platform-recurring-subscription.model';

function createProvider(): AsaasPaymentProvider {
  return new AsaasPaymentProvider({
    runtime: resolveAsaasApiRuntimeConfig(),
    apiKey: ASAAS_API_KEY.value(),
  });
}

export const processProviderWebhookEventTrigger = onDocumentCreated(
  {
    document: `${PROVIDER_WEBHOOK_EVENT_COLLECTION}/{eventId}`,
    region: FUNCTIONS_REGION,
    timeoutSeconds: 120,
    memory: '256MiB',
    secrets: [ASAAS_API_KEY],
  },
  async (event) => {
    const eventId = String(event.params['eventId'] ?? '').trim();
    if (!eventId) return;

    await processProviderWebhookEventById({
      eventId,
      provider: createProvider(),
    });
  }
);

export const reconcileProviderWebhookEvents = onSchedule(
  {
    schedule: 'every 10 minutes',
    timeZone: 'America/Sao_Paulo',
    region: FUNCTIONS_REGION,
    timeoutSeconds: 300,
    memory: '256MiB',
    secrets: [ASAAS_API_KEY],
  },
  async () => {
    const provider = createProvider();
    const now = Date.now();
    const snapshot = await db
      .collection(PROVIDER_WEBHOOK_EVENT_COLLECTION)
      .where('processingStatus', 'in', [
        'pending',
        'processing',
        'retry',
      ])
      .limit(100)
      .get();

    let processed = 0;

    for (const document of snapshot.docs) {
      const data = document.data();
      const nextAttemptAt = Number(data['nextAttemptAt'] ?? 0);
      const lastAttemptAt = Number(data['lastAttemptAt'] ?? 0);
      const processing = data['processingStatus'] === 'processing';

      if (nextAttemptAt > now) continue;
      if (processing && lastAttemptAt + 5 * 60 * 1_000 > now) continue;

      const result = await processProviderWebhookEventById({
        eventId: document.id,
        provider,
      });

      if (result.claimed) processed += 1;
    }

    console.log('[billing] provider webhook reconciliation completed', {
      scanned: snapshot.size,
      processed,
    });
  }
);

export const reconcileRecurringProviderCancellations = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeZone: 'America/Sao_Paulo',
    region: FUNCTIONS_REGION,
    timeoutSeconds: 300,
    memory: '256MiB',
    secrets: [ASAAS_API_KEY],
  },
  async () => {
    const provider = createProvider();
    const now = Date.now();
    const snapshot = await db
      .collection(PLATFORM_SUBSCRIPTION_COLLECTION)
      .where('needsProviderCancellation', '==', true)
      .limit(100)
      .get();

    let completed = 0;
    let failed = 0;

    for (const document of snapshot.docs) {
      const contract =
        document.data() as PlatformRecurringSubscriptionDoc;
      const nextAttemptAt =
        contract.providerCancellationNextAttemptAt ?? 0;

      if (nextAttemptAt > now) continue;

      try {
        await cancelRecurringContractAtProvider({
          contractId: document.id,
          provider,
          reason: 'scheduled-reconciliation',
        });
        completed += 1;
      } catch {
        failed += 1;
      }
    }

    console.log('[billing] recurring provider cancellation reconciliation', {
      scanned: snapshot.size,
      completed,
      failed,
    });
  }
);


export const reconcileRecurringProviderPlanChanges = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeZone: 'America/Sao_Paulo',
    region: FUNCTIONS_REGION,
    timeoutSeconds: 300,
    memory: '256MiB',
    secrets: [ASAAS_API_KEY],
  },
  async () => {
    if (!isAsaasSubscriptionUpdateEnabled()) {
      console.log('[billing] recurring plan change reconciliation disabled');
      return;
    }

    const provider = createProvider();
    const now = Date.now();
    const snapshot = await db
      .collection(PLATFORM_SUBSCRIPTION_COLLECTION)
      .where('needsProviderPlanChangeSync', '==', true)
      .limit(100)
      .get();

    let completed = 0;
    let deferred = 0;
    let failed = 0;

    for (const document of snapshot.docs) {
      const contract =
        document.data() as PlatformRecurringSubscriptionDoc;
      const pending = contract.pendingPlanChange ?? null;

      if (!pending) continue;
      const canceling = !!pending.cancellationRequestedAt;
      const nextAttemptAt = canceling
        ? pending.providerRevertNextAttemptAt
        : pending.providerUpdateNextAttemptAt;

      if (
        typeof nextAttemptAt === 'number'
        && nextAttemptAt > now
      ) {
        deferred += 1;
        continue;
      }

      try {
        if (canceling) {
          await revertPendingRecurringPlanChangeAtProvider({
            contractId: document.id,
            provider,
          });
        } else {
          await applyPendingRecurringPlanChangeAtProvider({
            contractId: document.id,
            provider,
          });
        }
        completed += 1;
      } catch {
        failed += 1;
      }
    }

    console.log('[billing] recurring plan change reconciliation', {
      scanned: snapshot.size,
      completed,
      deferred,
      failed,
    });
  }
);
