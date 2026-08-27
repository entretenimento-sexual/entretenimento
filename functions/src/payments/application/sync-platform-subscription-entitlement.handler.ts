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
// Antes de reconciliar a projeção, registra uma transição append-only em
// billing_audit. O documento usa id determinístico baseado no CloudEvent para
// que retries sejam idempotentes sem apagar ou reescrever histórico anterior.
//
// A rotina agendada permanece necessária para expiração causada apenas pelo
// avanço do relógio, quando nenhum documento é escrito no instante do término.
// -----------------------------------------------------------------------------

import { onDocumentWritten } from 'firebase-functions/v2/firestore';

import { FUNCTIONS_REGION } from '../../config/functions-region';
import {
  reconcilePlatformSubscriptionAccess,
} from './platform-subscription-projection.service';
import {
  createPlatformSubscriptionTransitionAudit,
} from './platform-subscription-audit.service';

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

function resolveEventOccurredAt(
  rawEventTime: unknown,
  beforeData: Record<string, unknown> | null,
  afterData: Record<string, unknown> | null
): number {
  const eventTime = Date.parse(String(rawEventTime ?? ''));
  if (Number.isFinite(eventTime)) return eventTime;

  const afterUpdatedAt = afterData?.['updatedAt'];
  if (typeof afterUpdatedAt === 'number' && Number.isFinite(afterUpdatedAt)) {
    return afterUpdatedAt;
  }

  const beforeUpdatedAt = beforeData?.['updatedAt'];
  if (typeof beforeUpdatedAt === 'number' && Number.isFinite(beforeUpdatedAt)) {
    return beforeUpdatedAt;
  }

  return 0;
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

    const eventId = String(event.id ?? '').trim()
      || `${entitlementId}:${String(event.time ?? 'unknown')}`;
    const occurredAt = resolveEventOccurredAt(
      event.time,
      beforeData,
      afterData
    );

    await createPlatformSubscriptionTransitionAudit({
      buyerUid: uid,
      entitlementId,
      eventId,
      beforeData,
      afterData,
      occurredAt,
    });

    await reconcilePlatformSubscriptionAccess(uid);
  }
);
