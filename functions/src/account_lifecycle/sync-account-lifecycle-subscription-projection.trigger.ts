// functions/src/account_lifecycle/sync-account-lifecycle-subscription-projection.trigger.ts
// -----------------------------------------------------------------------------
// SYNC ACCOUNT LIFECYCLE -> SUBSCRIPTION PROJECTION
// -----------------------------------------------------------------------------
// Quando uma conta volta ao estado ativo, o perfil público pode ter acabado de
// ser recriado com role neutra. O entitlement continua sendo a autoridade
// financeira; este trigger apenas reaplica a projeção canônica após o commit.
// -----------------------------------------------------------------------------

import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import {
  reconcilePlatformSubscriptionAccess,
} from '../payments/application/platform-subscription-projection.service';

export function shouldReconcileSubscriptionAfterLifecycleTransition(input: {
  beforeStatus: unknown;
  afterStatus: unknown;
}): boolean {
  const before = String(input.beforeStatus ?? '').trim();
  const after = String(input.afterStatus ?? '').trim();

  return after === 'active' && before !== 'active';
}

export const syncAccountLifecycleSubscriptionProjection = onDocumentWritten(
  {
    document: 'users/{uid}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const before = event.data?.before.exists
      ? event.data.before.data() ?? {}
      : {};
    const after = event.data?.after.exists
      ? event.data.after.data() ?? {}
      : {};

    if (!shouldReconcileSubscriptionAfterLifecycleTransition({
      beforeStatus: before['accountStatus'],
      afterStatus: after['accountStatus'],
    })) {
      return;
    }

    const uid = String(event.params.uid ?? '').trim();
    if (!uid) return;

    await reconcilePlatformSubscriptionAccess(uid);
  }
);
