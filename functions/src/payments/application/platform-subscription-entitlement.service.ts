// functions/src/payments/application/platform-subscription-entitlement.service.ts
// -----------------------------------------------------------------------------
// PLATFORM SUBSCRIPTION ENTITLEMENT SERVICE
// -----------------------------------------------------------------------------
// Avalia a fonte autorizativa da assinatura principal.
//
// Regras fail-closed:
// - documento determinístico por UID;
// - buyerUid deve corresponder ao usuário autenticado;
// - escopo deve ser platform_subscription;
// - role deve ser reconhecida;
// - startsAt deve existir e já ter iniciado;
// - endsAt ausente/null significa sem expiração definida; quando presente, deve
//   ser um número finito no futuro;
// - projeções em users/{uid} nunca substituem este entitlement.
// -----------------------------------------------------------------------------

import { db } from '../../firebaseApp';
import { PlatformRole } from '../domain/billing.model';

export interface PlatformSubscriptionEntitlementStatus {
  active: boolean;
  role: PlatformRole | null;
  startsAt: number | null;
  endsAt: number | null;
  updatedAt: number | null;
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
  const rawEndsAt = entitlement['endsAt'];
  const hasDefinedEndsAt = rawEndsAt !== null && rawEndsAt !== undefined;
  const endsAt = hasDefinedEndsAt
    ? toFiniteNumberOrNull(rawEndsAt)
    : null;
  const hasValidEndsAt = !hasDefinedEndsAt || endsAt !== null;
  const updatedAt = toFiniteNumberOrNull(entitlement['updatedAt']);

  const active =
    entitlement['active'] === true
    && entitlement['buyerUid'] === expectedBuyerUid
    && entitlement['scope'] === 'platform_subscription'
    && role !== null
    && startsAt !== null
    && startsAt <= now
    && hasValidEndsAt
    && (!hasDefinedEndsAt || (endsAt !== null && endsAt > now));

  return {
    active,
    role: active ? role : null,
    startsAt,
    endsAt,
    updatedAt,
  };
}

/**
 * Resolve o entitlement determinístico da assinatura principal.
 *
 * A leitura é feita pelo Admin SDK e nunca depende das permissões do cliente.
 */
export async function getActivePlatformSubscriptionEntitlement(
  uid: string,
  now = Date.now()
): Promise<PlatformSubscriptionEntitlementStatus> {
  const entitlementId = `platform_subscription_${uid}`;
  const snapshot = await db
    .collection('entitlements')
    .doc(entitlementId)
    .get();

  return evaluatePlatformSubscriptionEntitlement(
    snapshot.exists ? snapshot.data() : null,
    uid,
    now
  );
}
