// functions/src/payments/application/platform-subscription-entitlement.service.ts
// -----------------------------------------------------------------------------
// PLATFORM SUBSCRIPTION ENTITLEMENT SERVICE
// -----------------------------------------------------------------------------
// Avalia a fonte autorizativa da assinatura principal e calcula períodos
// mensais sem perder tempo já pago.
// -----------------------------------------------------------------------------

import { db } from '../../firebaseApp';
import { PlatformRole } from '../domain/billing.model';

export interface PlatformSubscriptionEntitlementStatus {
  active: boolean;
  role: PlatformRole | null;
  startsAt: number | null;
  endsAt: number | null;
  updatedAt: number | null;
  legacyEndsAtDerived: boolean;
}

export interface PlatformSubscriptionSettlementPeriod {
  startsAt: number;
  endsAt: number;
  extensionBase: number;
  extendedExistingAccess: boolean;
}

const PLATFORM_ROLE_WEIGHT: Readonly<Record<PlatformRole, number>> =
  Object.freeze({
    basic: 1,
    premium: 2,
    vip: 3,
  });

function toFiniteNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : null;
}

function isPlatformPlanKey(value: unknown): boolean {
  return value === 'basic' || value === 'premium' || value === 'vip';
}

export function isPlatformRole(value: unknown): value is PlatformRole {
  return value === 'basic' || value === 'premium' || value === 'vip';
}

export function hasMinimumPlatformRole(
  currentRole: PlatformRole | null,
  minimumRole: PlatformRole
): boolean {
  return currentRole !== null
    && PLATFORM_ROLE_WEIGHT[currentRole] >= PLATFORM_ROLE_WEIGHT[minimumRole];
}

/** Soma um mês civil em UTC, limitando o dia ao último dia do mês destino. */
export function calculatePlatformSubscriptionPeriodEnd(
  periodStartAt: number
): number {
  if (!Number.isFinite(periodStartAt)) {
    throw new Error('Início de período de assinatura inválido.');
  }

  const source = new Date(periodStartAt);
  const sourceDay = source.getUTCDate();
  const targetMonthStart = new Date(Date.UTC(
    source.getUTCFullYear(),
    source.getUTCMonth() + 1,
    1,
    source.getUTCHours(),
    source.getUTCMinutes(),
    source.getUTCSeconds(),
    source.getUTCMilliseconds()
  ));
  const lastTargetDay = new Date(Date.UTC(
    targetMonthStart.getUTCFullYear(),
    targetMonthStart.getUTCMonth() + 1,
    0
  )).getUTCDate();

  targetMonthStart.setUTCDate(Math.min(sourceDay, lastTargetDay));
  return targetMonthStart.getTime();
}

export function evaluatePlatformSubscriptionEntitlement(
  rawEntitlement: unknown,
  expectedBuyerUid: string,
  now = Date.now()
): PlatformSubscriptionEntitlementStatus {
  const entitlement = (rawEntitlement ?? {}) as Record<string, unknown>;
  const role = isPlatformRole(entitlement['grantedRole'])
    ? entitlement['grantedRole']
    : null;
  const startsAt = toFiniteNumberOrNull(entitlement['startsAt']);
  const explicitEndsAt = toFiniteNumberOrNull(entitlement['endsAt']);
  const missingEndsAt =
    entitlement['endsAt'] === null || entitlement['endsAt'] === undefined;
  const legacyEndsAtDerived =
    missingEndsAt &&
    startsAt !== null &&
    isPlatformPlanKey(entitlement['planKey']);
  const endsAt = explicitEndsAt ?? (
    legacyEndsAtDerived && startsAt !== null
      ? calculatePlatformSubscriptionPeriodEnd(startsAt)
      : null
  );
  const updatedAt = toFiniteNumberOrNull(entitlement['updatedAt']);

  const active =
    entitlement['active'] === true
    && entitlement['buyerUid'] === expectedBuyerUid
    && entitlement['scope'] === 'platform_subscription'
    && role !== null
    && startsAt !== null
    && startsAt <= now
    && endsAt !== null
    && endsAt > now;

  return {
    active,
    role: active ? role : null,
    startsAt,
    endsAt,
    updatedAt,
    legacyEndsAtDerived,
  };
}

/**
 * Resolve o próximo período pago.
 * - vigente: preserva startsAt e estende um mês a partir do fim atual;
 * - legado vigente sem endsAt: usa o fim derivado, sem perder dias pagos;
 * - vencido/inválido: inicia um novo período em now.
 */
export function resolvePlatformSubscriptionSettlementPeriod(
  rawEntitlement: unknown,
  buyerUid: string,
  now = Date.now()
): PlatformSubscriptionSettlementPeriod {
  if (!Number.isFinite(now)) {
    throw new Error('Instante de settlement inválido.');
  }

  const status = evaluatePlatformSubscriptionEntitlement(
    rawEntitlement,
    buyerUid,
    now
  );
  const extendedExistingAccess =
    status.active &&
    status.startsAt !== null &&
    status.endsAt !== null;
  const startsAt = extendedExistingAccess ? status.startsAt! : now;
  const extensionBase = extendedExistingAccess ? status.endsAt! : now;

  return {
    startsAt,
    extensionBase,
    endsAt: calculatePlatformSubscriptionPeriodEnd(extensionBase),
    extendedExistingAccess,
  };
}

/**
 * Lê e repara o entitlement determinístico. Entitlements antigos sem endsAt
 * recebem período mensal finito; active é reconciliado com a janela temporal.
 */
export async function getActivePlatformSubscriptionEntitlement(
  uid: string,
  now = Date.now()
): Promise<PlatformSubscriptionEntitlementStatus> {
  const entitlementId = `platform_subscription_${uid}`;
  const reference = db.collection('entitlements').doc(entitlementId);
  const snapshot = await reference.get();
  const raw = snapshot.exists ? snapshot.data() ?? {} : null;
  const status = evaluatePlatformSubscriptionEntitlement(raw, uid, now);

  if (!snapshot.exists) return status;

  const storedActive = (raw as Record<string, unknown>)['active'] === true;
  const shouldRepair =
    status.legacyEndsAtDerived || storedActive !== status.active;

  if (!shouldRepair) return status;

  const patch: Record<string, unknown> = {
    active: status.active,
    updatedAt: now,
  };

  if (status.endsAt !== null) {
    patch['endsAt'] = status.endsAt;
  }

  await reference.set(patch, { merge: true });

  return {
    ...status,
    updatedAt: now,
  };
}
