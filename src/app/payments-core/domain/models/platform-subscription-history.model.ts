// src/app/payments-core/domain/models/platform-subscription-history.model.ts
// -----------------------------------------------------------------------------
// Projeção sanitizada e read-only do histórico da assinatura da própria conta.
// Nenhum identificador financeiro interno é exposto ao frontend.
// -----------------------------------------------------------------------------

export type PlatformSubscriptionHistoryRole =
  | 'free'
  | 'basic'
  | 'premium'
  | 'vip';

export type PlatformSubscriptionHistoryPlanKey =
  | 'basic'
  | 'premium'
  | 'vip';

export type PlatformSubscriptionHistoryEventType =
  | 'subscription_started'
  | 'subscription_renewed'
  | 'subscription_upgraded'
  | 'subscription_downgraded'
  | 'subscription_expired'
  | 'subscription_deactivated'
  | 'subscription_repaired';

export type PlatformSubscriptionHistorySource =
  | 'payment_settlement'
  | 'subscription_reconciliation'
  | 'system_repair'
  | 'entitlement_change'
  | 'entitlement_deleted';

export interface PlatformSubscriptionHistorySnapshot {
  active: boolean;
  role: PlatformSubscriptionHistoryRole;
  planKey: PlatformSubscriptionHistoryPlanKey | null;
  startsAt: number | null;
  endsAt: number | null;
}

export interface PlatformSubscriptionHistoryItem {
  id: string;
  eventType: PlatformSubscriptionHistoryEventType;
  from: PlatformSubscriptionHistorySnapshot | null;
  to: PlatformSubscriptionHistorySnapshot | null;
  source: PlatformSubscriptionHistorySource;
  reason: string;
  occurredAt: number;
}

export interface PlatformSubscriptionHistoryPage {
  items: PlatformSubscriptionHistoryItem[];
  nextCursor: string | null;
}
