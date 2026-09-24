// functions/src/payments/application/process-provider-webhook.handler.ts
// -----------------------------------------------------------------------------
// ASYNC PROVIDER WEBHOOK PROCESSING
// -----------------------------------------------------------------------------
// Firestore trigger processa imediatamente; scheduler cobre retries, eventos
// fora de ordem e cancelamentos externos pendentes.
// -----------------------------------------------------------------------------

import {
  FieldPath,
  type QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  ASAAS_API_KEY,
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
import type {
  PlatformRecurringSubscriptionDoc,
} from '../domain/platform-recurring-subscription.model';
import type {
  ProviderWebhookEventDoc,
} from '../domain/provider-webhook.model';
import {
  PROVIDER_WEBHOOK_PROCESSING_LEASE_MS,
  PROVIDER_WEBHOOK_RECONCILIATION_LIMIT,
  RECURRING_PROVIDER_CANCELLATION_LIMIT,
  compareEligibleAt,
  isRecurringCancellationDue,
  providerWebhookEligibilityAt,
  recurringCancellationEligibilityAt,
} from './recurring-reconciliation-window.policy';

function sortWebhookDocuments(
  documents: QueryDocumentSnapshot[]
): QueryDocumentSnapshot[] {
  return documents.sort((left, right) =>
    compareEligibleAt(
      providerWebhookEligibilityAt(
        left.data() as ProviderWebhookEventDoc
      ) ?? Number.MAX_SAFE_INTEGER,
      providerWebhookEligibilityAt(
        right.data() as ProviderWebhookEventDoc
      ) ?? Number.MAX_SAFE_INTEGER,
      left.id,
      right.id
    )
  );
}

async function loadDueProviderWebhookEvents(
  now: number
): Promise<QueryDocumentSnapshot[]> {
  const collection = db.collection(PROVIDER_WEBHOOK_EVENT_COLLECTION);
  const staleBefore = now - PROVIDER_WEBHOOK_PROCESSING_LEASE_MS;
  const [pending, retry, staleProcessing] = await Promise.all([
    collection
      .where('processingStatus', '==', 'pending')
      .orderBy('createdAt', 'asc')
      .orderBy(FieldPath.documentId(), 'asc')
      .limit(PROVIDER_WEBHOOK_RECONCILIATION_LIMIT)
      .get(),
    collection
      .where('processingStatus', '==', 'retry')
      .where('nextAttemptAt', '<=', now)
      .orderBy('nextAttemptAt', 'asc')
      .orderBy(FieldPath.documentId(), 'asc')
      .limit(PROVIDER_WEBHOOK_RECONCILIATION_LIMIT)
      .get(),
    collection
      .where('processingStatus', '==', 'processing')
      .where('lastAttemptAt', '<=', staleBefore)
      .orderBy('lastAttemptAt', 'asc')
      .orderBy(FieldPath.documentId(), 'asc')
      .limit(PROVIDER_WEBHOOK_RECONCILIATION_LIMIT)
      .get(),
  ]);

  return sortWebhookDocuments([
    ...pending.docs,
    ...retry.docs,
    ...staleProcessing.docs,
  ]).slice(0, PROVIDER_WEBHOOK_RECONCILIATION_LIMIT);
}

async function loadDueRecurringCancellations(
  now: number
): Promise<QueryDocumentSnapshot[]> {
  const collection = db.collection(PLATFORM_SUBSCRIPTION_COLLECTION);
  const [scheduled, legacyNull] = await Promise.all([
    collection
      .where('needsProviderCancellation', '==', true)
      .where('providerCancellationNextAttemptAt', '<=', now)
      .orderBy('providerCancellationNextAttemptAt', 'asc')
      .orderBy(FieldPath.documentId(), 'asc')
      .limit(RECURRING_PROVIDER_CANCELLATION_LIMIT)
      .get(),
    collection
      .where('needsProviderCancellation', '==', true)
      .where('providerCancellationNextAttemptAt', '==', null)
      .limit(RECURRING_PROVIDER_CANCELLATION_LIMIT)
      .get(),
  ]);
  const byId = new Map<string, QueryDocumentSnapshot>();

  for (const document of [...legacyNull.docs, ...scheduled.docs]) {
    const contract = document.data() as PlatformRecurringSubscriptionDoc;
    if (!isRecurringCancellationDue(contract, now)) continue;
    byId.set(document.id, document);
  }

  return [...byId.values()]
    .sort((left, right) =>
      compareEligibleAt(
        recurringCancellationEligibilityAt(
          left.data() as PlatformRecurringSubscriptionDoc
        ) ?? Number.MAX_SAFE_INTEGER,
        recurringCancellationEligibilityAt(
          right.data() as PlatformRecurringSubscriptionDoc
        ) ?? Number.MAX_SAFE_INTEGER,
        left.id,
        right.id
      )
    )
    .slice(0, RECURRING_PROVIDER_CANCELLATION_LIMIT);
}

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
    const documents = await loadDueProviderWebhookEvents(now);
    let processed = 0;

    for (const document of documents) {
      const result = await processProviderWebhookEventById({
        eventId: document.id,
        provider,
      });

      if (result.claimed) processed += 1;
    }

    console.log('[billing] provider webhook reconciliation completed', {
      selectedDue: documents.length,
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
    const documents = await loadDueRecurringCancellations(now);
    let completed = 0;
    let failed = 0;

    for (const document of documents) {
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
      selectedDue: documents.length,
      completed,
      failed,
    });
  }
);
