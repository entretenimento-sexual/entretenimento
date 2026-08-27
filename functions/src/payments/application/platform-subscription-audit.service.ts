// functions/src/payments/application/platform-subscription-audit.service.ts
// -----------------------------------------------------------------------------
// PLATFORM SUBSCRIPTION AUDIT
// -----------------------------------------------------------------------------
// Trilha append-only de mudanças da assinatura principal.
//
// - billing_audit permanece interno e não é exposto diretamente ao cliente;
// - cada evento usa id determinístico para que retries não dupliquem histórico;
// - o registro guarda apenas dados necessários à auditoria de acesso/assinatura;
// - a UI recebe posteriormente uma projeção sanitizada por callable autenticada.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';

import { db } from '../../firebaseApp';
import type {
  PlatformPlanKey,
  PlatformRole,
} from '../domain/billing.model';

export const PLATFORM_SUBSCRIPTION_TRANSITION_ACTION =
  'platform_subscription_transition' as const;

export type PlatformSubscriptionTransitionEventType =
  | 'subscription_started'
  | 'subscription_renewed'
  | 'subscription_upgraded'
  | 'subscription_downgraded'
  | 'subscription_expired'
  | 'subscription_deactivated'
  | 'subscription_repaired';

export type PlatformSubscriptionTransitionSource =
  | 'payment_settlement'
  | 'subscription_reconciliation'
  | 'system_repair'
  | 'entitlement_change'
  | 'entitlement_deleted';

export interface PlatformSubscriptionAuditSnapshot {
  active: boolean;
  role: PlatformRole | null;
  planKey: PlatformPlanKey | null;
  startsAt: number | null;
  endsAt: number | null;
}

export interface PlatformSubscriptionTransitionAuditRecord {
  action: typeof PLATFORM_SUBSCRIPTION_TRANSITION_ACTION;
  eventType: PlatformSubscriptionTransitionEventType;
  buyerUid: string;
  entitlementId: string;
  from: PlatformSubscriptionAuditSnapshot | null;
  to: PlatformSubscriptionAuditSnapshot | null;
  source: PlatformSubscriptionTransitionSource;
  reason: string;
  sourceCheckoutSessionId: string | null;
  sourcePaymentTransactionId: string | null;
  occurredAt: number;
  recordedAt: number;
}

const PLATFORM_ROLE_RANK: Readonly<Record<PlatformRole, number>> = Object.freeze({
  basic: 1,
  premium: 2,
  vip: 3,
});

const MAX_REVERSE_EPOCH = 9_999_999_999_999;

function normalizeRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteEpoch(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : null;
}

function normalizeText(value: unknown, maxLength = 240): string | null {
  const normalized = String(value ?? '').trim().slice(0, maxLength);
  return normalized || null;
}

function isPlatformRole(value: unknown): value is PlatformRole {
  return value === 'basic' || value === 'premium' || value === 'vip';
}

function isPlatformPlanKey(value: unknown): value is PlatformPlanKey {
  return value === 'basic' || value === 'premium' || value === 'vip';
}

export function buildPlatformSubscriptionAuditSnapshot(
  rawValue: unknown
): PlatformSubscriptionAuditSnapshot | null {
  const record = normalizeRecord(rawValue);
  if (!record) return null;

  const active = record['active'] === true;
  const role = active && isPlatformRole(record['grantedRole'])
    ? record['grantedRole']
    : null;

  return {
    active,
    role,
    planKey: isPlatformPlanKey(record['planKey'])
      ? record['planKey']
      : null,
    startsAt: finiteEpoch(record['startsAt']),
    endsAt: finiteEpoch(record['endsAt']),
  };
}

function sameSnapshot(
  previous: PlatformSubscriptionAuditSnapshot | null,
  current: PlatformSubscriptionAuditSnapshot | null
): boolean {
  if (previous === current) return true;
  if (!previous || !current) return false;

  return previous.active === current.active
    && previous.role === current.role
    && previous.planKey === current.planKey
    && previous.startsAt === current.startsAt
    && previous.endsAt === current.endsAt;
}

export function resolvePlatformSubscriptionTransitionType(params: {
  before: PlatformSubscriptionAuditSnapshot | null;
  after: PlatformSubscriptionAuditSnapshot | null;
  occurredAt: number;
}): PlatformSubscriptionTransitionEventType | null {
  const { before, after, occurredAt } = params;

  if (sameSnapshot(before, after)) return null;

  if (!before && after) {
    return after.active
      ? 'subscription_started'
      : 'subscription_repaired';
  }

  if (before && !after) {
    return before.active
      && before.endsAt !== null
      && before.endsAt <= occurredAt
      ? 'subscription_expired'
      : 'subscription_deactivated';
  }

  if (!before || !after) return null;

  if (!before.active && after.active) {
    return 'subscription_started';
  }

  if (before.active && !after.active) {
    return before.endsAt !== null && before.endsAt <= occurredAt
      ? 'subscription_expired'
      : 'subscription_deactivated';
  }

  if (before.active && after.active) {
    if (before.role && after.role && before.role !== after.role) {
      return PLATFORM_ROLE_RANK[after.role] > PLATFORM_ROLE_RANK[before.role]
        ? 'subscription_upgraded'
        : 'subscription_downgraded';
    }

    if (
      before.role === after.role
      && before.endsAt !== null
      && after.endsAt !== null
      && after.endsAt > before.endsAt
    ) {
      return 'subscription_renewed';
    }
  }

  return 'subscription_repaired';
}

function resolveTransitionSource(params: {
  eventType: PlatformSubscriptionTransitionEventType;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
}): PlatformSubscriptionTransitionSource {
  const beforeTransactionId = normalizeText(
    params.beforeData?.['sourcePaymentTransactionId']
  );
  const afterTransactionId = normalizeText(
    params.afterData?.['sourcePaymentTransactionId']
  );

  if (afterTransactionId && afterTransactionId !== beforeTransactionId) {
    return 'payment_settlement';
  }

  if (!params.afterData) return 'entitlement_deleted';
  if (params.eventType === 'subscription_expired') {
    return 'subscription_reconciliation';
  }
  if (params.eventType === 'subscription_repaired') {
    return 'system_repair';
  }
  return 'entitlement_change';
}

function resolveTransitionReason(
  eventType: PlatformSubscriptionTransitionEventType,
  source: PlatformSubscriptionTransitionSource
): string {
  if (source === 'payment_settlement') {
    if (eventType === 'subscription_renewed') return 'paid_period_extension';
    if (eventType === 'subscription_upgraded') return 'paid_plan_upgrade';
    if (eventType === 'subscription_downgraded') return 'paid_plan_change';
    return 'payment_confirmed';
  }

  switch (eventType) {
  case 'subscription_expired':
    return 'period_elapsed';
  case 'subscription_deactivated':
    return source === 'entitlement_deleted'
      ? 'entitlement_deleted'
      : 'entitlement_deactivated';
  case 'subscription_repaired':
    return 'subscription_state_reconciled';
  default:
    return 'subscription_state_changed';
  }
}

function hashValue(value: string, length: number): string {
  return createHash('sha256')
    .update(value)
    .digest('hex')
    .slice(0, length);
}

export function buildPlatformSubscriptionAuditPrefix(buyerUid: string): string {
  const uid = String(buyerUid ?? '').trim();
  if (!uid) throw new Error('invalid-platform-subscription-audit-uid');
  return `platform_subscription_transition_${hashValue(uid, 20)}_`;
}

export function buildPlatformSubscriptionTransitionAuditId(params: {
  buyerUid: string;
  eventId: string;
  occurredAt: number;
}): string {
  const prefix = buildPlatformSubscriptionAuditPrefix(params.buyerUid);
  const eventId = String(params.eventId ?? '').trim();
  if (!eventId) throw new Error('invalid-platform-subscription-audit-event-id');

  const occurredAt = finiteEpoch(params.occurredAt) ?? 0;
  const bounded = Math.min(occurredAt, MAX_REVERSE_EPOCH);
  const reverseEpoch = String(MAX_REVERSE_EPOCH - bounded).padStart(13, '0');

  return `${prefix}${reverseEpoch}_${hashValue(eventId, 24)}`;
}

function resolveOccurredAt(params: {
  requested: unknown;
  beforeData: Record<string, unknown> | null;
  afterData: Record<string, unknown> | null;
}): number {
  // updatedAt do documento é preferido quando existe porque é estável entre a
  // transação de settlement e o CloudEvent posterior. Isso permite que ambos
  // construam exatamente o mesmo id para o mesmo pagamento.
  return finiteEpoch(params.afterData?.['updatedAt'])
    ?? finiteEpoch(params.requested)
    ?? finiteEpoch(params.beforeData?.['updatedAt'])
    ?? 0;
}

export function buildPlatformSubscriptionTransitionAuditRecord(params: {
  buyerUid: string;
  entitlementId: string;
  eventId: string;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
  occurredAt?: number | null;
  recordedAt?: number;
}): {
  id: string;
  record: PlatformSubscriptionTransitionAuditRecord;
} | null {
  const buyerUid = String(params.buyerUid ?? '').trim();
  const entitlementId = String(params.entitlementId ?? '').trim();
  const eventId = String(params.eventId ?? '').trim();
  if (!buyerUid || !entitlementId || !eventId) {
    throw new Error('invalid-platform-subscription-audit-input');
  }

  const beforeData = normalizeRecord(params.beforeData);
  const afterData = normalizeRecord(params.afterData);
  const before = buildPlatformSubscriptionAuditSnapshot(beforeData);
  const after = buildPlatformSubscriptionAuditSnapshot(afterData);
  const occurredAt = resolveOccurredAt({
    requested: params.occurredAt,
    beforeData,
    afterData,
  });
  const eventType = resolvePlatformSubscriptionTransitionType({
    before,
    after,
    occurredAt,
  });

  if (!eventType) return null;

  const source = resolveTransitionSource({
    eventType,
    beforeData,
    afterData,
  });
  const sourceCheckoutSessionId = normalizeText(
    afterData?.['sourceCheckoutSessionId']
      ?? beforeData?.['sourceCheckoutSessionId']
  );
  const sourcePaymentTransactionId = normalizeText(
    afterData?.['sourcePaymentTransactionId']
      ?? beforeData?.['sourcePaymentTransactionId']
  );
  const stableEventId =
    source === 'payment_settlement' && sourcePaymentTransactionId
      ? `payment_settlement:${sourcePaymentTransactionId}`
      : eventId;

  return {
    id: buildPlatformSubscriptionTransitionAuditId({
      buyerUid,
      eventId: stableEventId,
      occurredAt,
    }),
    record: {
      action: PLATFORM_SUBSCRIPTION_TRANSITION_ACTION,
      eventType,
      buyerUid,
      entitlementId,
      from: before,
      to: after,
      source,
      reason: resolveTransitionReason(eventType, source),
      sourceCheckoutSessionId,
      sourcePaymentTransactionId,
      occurredAt,
      recordedAt: finiteEpoch(params.recordedAt) ?? Date.now(),
    },
  };
}

export async function createPlatformSubscriptionTransitionAudit(params: {
  buyerUid: string;
  entitlementId: string;
  eventId: string;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
  occurredAt?: number | null;
}): Promise<{ written: boolean; auditId: string | null }> {
  const built = buildPlatformSubscriptionTransitionAuditRecord(params);
  if (!built) return { written: false, auditId: null };

  const auditRef = db.collection('billing_audit').doc(built.id);
  let written = false;

  await db.runTransaction(async (tx: FirebaseFirestore.Transaction) => {
    const existing = await tx.get(auditRef);
    if (existing.exists) return;
    tx.create(auditRef, built.record);
    written = true;
  });

  return { written, auditId: built.id };
}
