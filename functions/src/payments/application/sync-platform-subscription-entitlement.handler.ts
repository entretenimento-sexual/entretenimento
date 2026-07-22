// functions/src/payments/application/sync-platform-subscription-entitlement.handler.ts
// -----------------------------------------------------------------------------
// SYNC PLATFORM SUBSCRIPTION ENTITLEMENT
// -----------------------------------------------------------------------------
// Reage a qualquer alteração da verdade financeira:
// - concessão/renovação;
// - cancelamento ou revogação antecipada;
// - migração de período legado;
// - exclusão do entitlement.
//
// A rotina agendada permanece necessária para expiração causada apenas pelo
// avanço do relógio, quando nenhum documento é escrito no instante do término.
// -----------------------------------------------------------------------------

import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  reconcilePlatformSubscriptionAccess,
} from './platform-subscription-projection.service';

const PLATFORM_ENTITLEMENT_PREFIX = 'platform_subscription_';

export function resolvePlatformSubscriptionBuyerUid(params: {
  entitlementId: string;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
}): string | null {
  const fromPayload = String(
    params.afterData?.['buyerUid'] ?? params.beforeData?.['buyerUid'] ?? ''
  ).trim();

  if (fromPayload) return fromPayload;

  const entitlementId = String(params.entitlementId ?? '').trim();
  if (!entitlementId.startsWith(PLATFORM_ENTITLEMENT_PREFIX)) return null;

  return entitlementId.slice(PLATFORM_ENTITLEMENT_PREFIX.length).trim() || null;
}

export const syncPlatformSubscriptionEntitlement = onDocumentWritten(
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
      !entitlementId.startsWith(PLATFORM_ENTITLEMENT_PREFIX) &&
      scope !== 'platform_subscription'
    ) {
      return;
    }

    const uid = resolvePlatformSubscriptionBuyerUid({
      entitlementId,
      beforeData,
      afterData,
    });

    if (!uid) {
      console.warn('[billing] Entitlement de plataforma sem buyerUid.', {
        entitlementId,
      });
      return;
    }

    await reconcilePlatformSubscriptionAccess(uid);
  }
);
