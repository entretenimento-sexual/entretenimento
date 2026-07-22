// functions/src/payments/application/reconcile-platform-subscriptions.handler.ts
// -----------------------------------------------------------------------------
// RECONCILE PLATFORM SUBSCRIPTIONS
// -----------------------------------------------------------------------------
// Mantém entitlements e projeções operacionais sincronizados mesmo quando o
// usuário não abre o aplicativo após renovação, expiração ou migração legada.
//
// Segurança:
// - a avaliação continua fail-closed;
// - o cliente não participa da reconciliação;
// - Firestore Rules também verificam subscriptionEndsAt contra request.time.
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

export const reconcilePlatformSubscriptions = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeZone: 'America/Sao_Paulo',
    region: FUNCTIONS_REGION,
  },
  async () => {
    let cursor: QueryDocumentSnapshot | null = null;
    let processed = 0;

    while (true) {
      let query = db
        .collection('entitlements')
        .where('scope', '==', 'platform_subscription')
        .orderBy(FieldPath.documentId())
        .limit(PAGE_SIZE);

      if (cursor) {
        query = query.startAfter(cursor);
      }

      const page = await query.get();

      if (page.empty) {
        break;
      }

      await reconcileChunk(page.docs);
      processed += page.size;
      cursor = page.docs[page.docs.length - 1] ?? null;

      if (page.size < PAGE_SIZE) {
        break;
      }
    }

    console.log('[billing] Reconciliação de assinaturas concluída.', {
      processed,
    });
  }
);
