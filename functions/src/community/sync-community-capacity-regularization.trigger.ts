// functions/src/community/sync-community-capacity-regularization.trigger.ts
// -----------------------------------------------------------------------------
// SYNC COMMUNITY CAPACITY REGULARIZATION
// -----------------------------------------------------------------------------
// Reage à fonte financeira canônica. A reconciliação fica centralizada no
// service para poder ser reutilizada também após transferências/arquivamentos.
// -----------------------------------------------------------------------------

import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../config/functions-region';
import {
  reconcilePersonalCommunityCapacityRegularization,
} from './community-capacity-regularization.service';

const PLATFORM_ENTITLEMENT_PREFIX = 'platform_subscription_';

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return /^[A-Za-z0-9:_-]{1,160}$/.test(normalized) ? normalized : null;
}

function buyerUidFromEvent(input: {
  entitlementId: string;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
}): string | null {
  const payloadUid = cleanId(
    input.afterData?.['buyerUid'] ?? input.beforeData?.['buyerUid']
  );
  if (payloadUid) return payloadUid;

  return input.entitlementId.startsWith(PLATFORM_ENTITLEMENT_PREFIX)
    ? cleanId(input.entitlementId.slice(PLATFORM_ENTITLEMENT_PREFIX.length))
    : null;
}

export const syncCommunityCapacityRegularization = onDocumentWritten(
  {
    document: 'entitlements/{entitlementId}',
    region: FUNCTIONS_REGION,
  },
  async (event) => {
    const entitlementId = String(event.params.entitlementId ?? '').trim();
    const beforeData = event.data?.before.exists
      ? event.data.before.data() as Record<string, unknown>
      : null;
    const afterData = event.data?.after.exists
      ? event.data.after.data() as Record<string, unknown>
      : null;
    const scope = String(
      afterData?.['scope'] ?? beforeData?.['scope'] ?? ''
    ).trim();

    if (
      !entitlementId.startsWith(PLATFORM_ENTITLEMENT_PREFIX)
      && scope !== 'platform_subscription'
    ) {
      return;
    }

    const ownerUid = buyerUidFromEvent({
      entitlementId,
      beforeData,
      afterData,
    });
    if (!ownerUid) return;

    await reconcilePersonalCommunityCapacityRegularization({
      ownerUid,
      rawEntitlement: afterData,
    });
  }
);
