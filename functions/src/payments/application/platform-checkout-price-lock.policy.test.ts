import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PLATFORM_CHECKOUT_PRICE_LOCK_MS,
  isPlatformCheckoutPriceLockActive,
  resolvePlatformCheckoutPriceLockExpiresAt,
  resolveStoredPlatformCheckoutExpiresAt,
} from './platform-checkout-price-lock.policy';

const CREATED_AT = Date.UTC(2026, 8, 23, 15, 0, 0);

test('congela o preço por 30 minutos quando provider não informa expiração', () => {
  assert.equal(
    resolvePlatformCheckoutPriceLockExpiresAt({ createdAt: CREATED_AT }),
    CREATED_AT + PLATFORM_CHECKOUT_PRICE_LOCK_MS
  );
});

test('respeita expiração anterior informada pelo provider', () => {
  const providerExpiresAt = CREATED_AT + 10 * 60 * 1_000;
  assert.equal(
    resolvePlatformCheckoutPriceLockExpiresAt({
      createdAt: CREATED_AT,
      providerExpiresAt,
    }),
    providerExpiresAt
  );
});

test('não amplia a janela quando provider informa expiração mais longa', () => {
  const providerExpiresAt = CREATED_AT + 2 * 60 * 60 * 1_000;
  assert.equal(
    resolvePlatformCheckoutPriceLockExpiresAt({
      createdAt: CREATED_AT,
      providerExpiresAt,
    }),
    CREATED_AT + PLATFORM_CHECKOUT_PRICE_LOCK_MS
  );
});

test('checkout legado sem expiresAt deriva a mesma janela a partir de createdAt', () => {
  assert.equal(
    resolveStoredPlatformCheckoutExpiresAt({ createdAt: CREATED_AT }),
    CREATED_AT + PLATFORM_CHECKOUT_PRICE_LOCK_MS
  );
});

test('considera preço expirado no limite exato', () => {
  const checkout = {
    createdAt: CREATED_AT,
    expiresAt: CREATED_AT + PLATFORM_CHECKOUT_PRICE_LOCK_MS,
  };

  assert.equal(
    isPlatformCheckoutPriceLockActive(
      checkout,
      CREATED_AT + PLATFORM_CHECKOUT_PRICE_LOCK_MS - 1
    ),
    true
  );
  assert.equal(
    isPlatformCheckoutPriceLockActive(
      checkout,
      CREATED_AT + PLATFORM_CHECKOUT_PRICE_LOCK_MS
    ),
    false
  );
});
