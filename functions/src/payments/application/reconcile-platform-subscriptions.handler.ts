// functions/src/payments/application/reconcile-platform-subscriptions.handler.ts
// -----------------------------------------------------------------------------
// RECONCILE PLATFORM SUBSCRIPTIONS
// -----------------------------------------------------------------------------
// A rotina agendada trata somente mudanças causadas pelo relógio:
// - entitlements ativos cujo endsAt já venceu;
// - entitlements mensais legados com endsAt explicitamente null.
// Alterações documentais são tratadas pelo trigger do entitlement.
// -----------------------------------------------------------------------------

import {
  FieldPath,
  QueryDocumentSnapshot,
} from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import { db } from '../../firebaseApp';
import {
  reconcilePlatformSubscriptionAccess,
} from './platform-subscription-projection.service';

const PAGE_SIZE = 100;
const CONCURRENCY = 10;

type ReconciliationQueryFactory = (
  cursor: QueryDocumentSnapshot | null
) => FirebaseFirestore.Query;

async function reconcileChunk(
  documents: QueryDocumentSnapshot[]
): Promise<void> {
  for (let index = 0; index < documents.length; index += CONCURRENCY) {
    const chunk = documents.slice(index, index + CONCURRENCY);

    await Promise.all(
      chunk.map(async (document) => {
        const uid = String(document.data()?.['buyerUid'] ?? '').trim();

        if (!uid) {
          console.warn('[billing] Entitlement sem buyerUid ignorado.', {
            entitlementId: document.id,
          });
          return;
        }

        try {
          await reconcilePlatformSubscriptionAccess(uid);
        } catch (error) {
          console.error('[billing] Falha ao reconciliar assinatura.', {
            entitlementId: document.id,
            uid,
            error,
          });
        }
      })
    );
  }
}

async function reconcileQuery(
  createQuery: ReconciliationQueryFactory
): Promise<number> {
  let cursor: QueryDocumentSnapshot | null = null;
  let processed = 0;

  while (true) {
    const page = await createQuery(cursor).get();
    if (page.empty) break;

    await reconcileChunk(page.docs);
    processed += page.size;
    cursor = page.docs[page.docs.length - 1] ?? null;

    if (page.size < PAGE_SIZE) break;
  }

  return processed;
}

export const reconcilePlatformSubscriptions = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeZone: 'America/Sao_Paulo',
    region: FUNCTIONS_REGION,
  },
  async () => {
    const now = Date.now();

    const expired = await reconcileQuery((cursor) => {
      let query = db
        .collection('entitlements')
        .where('scope', '==', 'platform_subscription')
        .where('active', '==', true)
        .where('endsAt', '<=', now)
        .orderBy('endsAt', 'asc')
        .orderBy(FieldPath.documentId(), 'asc')
        .limit(PAGE_SIZE);

      if (cursor) query = query.startAfter(cursor);
      return query;
    });

    const legacy = await reconcileQuery((cursor) => {
      let query = db
        .collection('entitlements')
        .where('scope', '==', 'platform_subscription')
        .where('active', '==', true)
        .where('endsAt', '==', null)
        .orderBy(FieldPath.documentId(), 'asc')
        .limit(PAGE_SIZE);

      if (cursor) query = query.startAfter(cursor);
      return query;
    });

    console.log('[billing] Reconciliação de assinaturas concluída.', {
      expired,
      legacy,
      processed: expired + legacy,
    });
  }
);
