// functions/src/discovery/discovery-subscription-access.ts
// -----------------------------------------------------------------------------
// VALIDAÇÃO CANÔNICA DE PLANO PARA PROJEÇÕES DE DISCOVERY
// -----------------------------------------------------------------------------
// Não concede entitlement. Apenas interpreta a projeção versionada já produzida
// pelo domínio de billing, seguindo o mesmo contrato usado pelo frontend/Rules.
// -----------------------------------------------------------------------------

export type DiscoveryMinimumPlan = 'basic' | 'premium' | 'vip';

export function hasMinimumActiveDiscoveryPlan(
  user: Record<string, unknown>,
  minimum: DiscoveryMinimumPlan,
  now = Date.now()
): boolean {
  const role = String(user['tier'] ?? user['role'] ?? '')
    .trim()
    .toLowerCase();

  if (role === 'admin') return true;

  const rank: Readonly<Record<DiscoveryMinimumPlan, number>> = {
    basic: 1,
    premium: 2,
    vip: 3,
  };

  if (!(role in rank)) return false;
  if (user['billingProjectionVersion'] !== 1) return false;
  if (user['isSubscriber'] !== true) return false;
  if (user['subscriptionStatus'] !== 'active') return false;
  if (user['subscriptionScope'] !== 'platform_subscription') return false;

  const startsAt = toMillis(user['subscriptionStartedAt']);
  const endsAt = toMillis(user['subscriptionEndsAt']);

  return (
    startsAt !== null &&
    endsAt !== null &&
    startsAt < endsAt &&
    now >= startsAt &&
    now < endsAt &&
    rank[role as DiscoveryMinimumPlan] >= rank[minimum]
  );
}

function toMillis(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const timestamp = value as { toMillis?: () => number } | null | undefined;
  if (typeof timestamp?.toMillis !== 'function') return null;

  const millis = timestamp.toMillis();
  return Number.isFinite(millis) ? millis : null;
}
