// functions/src/payments/application/platform-checkout-price-lock.policy.ts
// -----------------------------------------------------------------------------
// PLATFORM CHECKOUT PRICE LOCK
// -----------------------------------------------------------------------------
// O catálogo é canônico para novos checkouts. Cada checkout congela o snapshot
// financeiro por uma janela curta; após a janela, uma intenção ainda não paga
// deve ser recriada usando o catálogo vigente.
//
// Checkouts já pagos não são invalidados por esta policy.
// -----------------------------------------------------------------------------

export const PLATFORM_CHECKOUT_PRICE_LOCK_MS = 30 * 60 * 1_000;

function finiteEpoch(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.trunc(value)
    : null;
}

export function resolvePlatformCheckoutPriceLockExpiresAt(input: {
  createdAt: number;
  providerExpiresAt?: unknown;
}): number {
  const createdAt = finiteEpoch(input.createdAt);
  if (!createdAt) {
    throw new Error('invalid-platform-checkout-created-at');
  }

  const catalogLockExpiresAt = createdAt + PLATFORM_CHECKOUT_PRICE_LOCK_MS;
  const providerExpiresAt = finiteEpoch(input.providerExpiresAt);

  return providerExpiresAt && providerExpiresAt > createdAt
    ? Math.min(catalogLockExpiresAt, providerExpiresAt)
    : catalogLockExpiresAt;
}

export function resolveStoredPlatformCheckoutExpiresAt(
  rawCheckout: unknown
): number | null {
  if (!rawCheckout || typeof rawCheckout !== 'object') return null;
  const checkout = rawCheckout as Record<string, unknown>;
  const explicit = finiteEpoch(checkout['expiresAt']);
  if (explicit) return explicit;

  const createdAt = finiteEpoch(checkout['createdAt']);
  return createdAt
    ? createdAt + PLATFORM_CHECKOUT_PRICE_LOCK_MS
    : null;
}

export function isPlatformCheckoutPriceLockActive(
  rawCheckout: unknown,
  now = Date.now()
): boolean {
  const expiresAt = resolveStoredPlatformCheckoutExpiresAt(rawCheckout);
  return Number.isFinite(now) && expiresAt !== null && expiresAt > now;
}
