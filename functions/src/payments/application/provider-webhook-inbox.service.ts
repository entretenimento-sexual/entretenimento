// functions/src/payments/application/provider-webhook-inbox.service.ts
// -----------------------------------------------------------------------------
// PROVIDER WEBHOOK INBOX
// -----------------------------------------------------------------------------
// Webhook validado é persistido de forma idempotente antes da resposta HTTP.
// O processamento financeiro pesado ocorre depois, fora da requisição pública.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import { db } from '../../firebaseApp';
import type {
  ProviderWebhookEventDoc,
  VerifiedProviderWebhookEvent,
} from '../domain/provider-webhook.model';

export const PROVIDER_WEBHOOK_EVENT_COLLECTION = 'provider_webhook_events';

export function buildProviderWebhookDocumentId(input: {
  provider: string;
  providerEventId: string;
}): string {
  const digest = createHash('sha256')
    .update(`${input.provider}:${input.providerEventId}`)
    .digest('hex');

  return `provider_webhook_${digest}`;
}

export async function persistVerifiedProviderWebhookEvent(
  event: VerifiedProviderWebhookEvent
): Promise<{
  id: string;
  created: boolean;
}> {
  const id = buildProviderWebhookDocumentId({
    provider: event.provider,
    providerEventId: event.providerEventId,
  });
  const ref = db.collection(PROVIDER_WEBHOOK_EVENT_COLLECTION).doc(id);
  let created = false;

  await db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) return;

    const now = Date.now();
    const doc: ProviderWebhookEventDoc = {
      id,
      ...event,
      processingStatus: 'pending',
      attemptCount: 0,
      nextAttemptAt: null,
      processedAt: null,
      lastAttemptAt: null,
      lastErrorCode: null,
      createdAt: now,
      updatedAt: now,
    };

    tx.create(ref, doc);
    created = true;
  });

  return { id, created };
}
