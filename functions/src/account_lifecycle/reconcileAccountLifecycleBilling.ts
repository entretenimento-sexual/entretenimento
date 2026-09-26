// functions/src/account_lifecycle/reconcileAccountLifecycleBilling.ts
// -----------------------------------------------------------------------------
// ACCOUNT LIFECYCLE BILLING RECONCILIATION
// -----------------------------------------------------------------------------
// Retoma obrigações persistidas por suspensão/exclusão quando a tentativa
// imediata não conseguiu estabelecer o cancelamento financeiro local.
// -----------------------------------------------------------------------------

import { onSchedule } from 'firebase-functions/v2/scheduler';

import { db } from '../firebaseApp';
import { ASAAS_API_KEY } from '../payments/config/asaas.config';
import { ACCOUNT_LIFECYCLE_REGION } from './_shared';
import {
  reconcileAccountLifecycleBillingCancellation,
} from './account-lifecycle-billing.service';

const BATCH_LIMIT = 100;

export const reconcileAccountLifecycleBilling = onSchedule(
  {
    region: ACCOUNT_LIFECYCLE_REGION,
    schedule: 'every 15 minutes',
    timeZone: 'America/Sao_Paulo',
    timeoutSeconds: 300,
    memory: '256MiB',
    secrets: [ASAAS_API_KEY],
  },
  async () => {
    const snapshot = await db
      .collection('users')
      .where('billingCancellationPending', '==', true)
      .limit(BATCH_LIMIT)
      .get();

    let completed = 0;
    let pending = 0;

    for (const document of snapshot.docs) {
      const result = await reconcileAccountLifecycleBillingCancellation({
        uid: document.id,
        fallbackReason: 'account-lifecycle-reconciliation',
      });

      if (result.providerCancellationStatus === 'pending') {
        pending += 1;
      } else {
        completed += 1;
      }
    }

    console.log('[account-lifecycle] billing reconciliation completed', {
      scanned: snapshot.size,
      completed,
      pending,
    });
  }
);
