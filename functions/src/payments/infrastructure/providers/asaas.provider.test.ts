import assert from 'node:assert/strict';
import test from 'node:test';

import { HttpsError } from 'firebase-functions/v2/https';

import { AsaasPaymentProvider } from './asaas.provider';

const runtime = {
  environment: 'sandbox' as const,
  apiBaseUrl: 'https://api-sandbox.asaas.com/v3',
  checkoutBaseUrl: 'https://sandbox.asaas.com/checkoutSession/show',
  appBaseUrl: 'https://example.test',
};

const webhookToken = '0123456789abcdef0123456789abcdef';

test('verifica webhook Asaas com token separado da API key', async () => {
  const provider = new AsaasPaymentProvider({
    webhookToken,
  });
  const rawBody = JSON.stringify({
    id: 'evt_1',
    event: 'PAYMENT_CONFIRMED',
    payment: {
      id: 'pay_1',
      subscription: 'sub_1',
      customer: 'cus_1',
      value: 29.99,
      status: 'CONFIRMED',
      dateCreated: '2026-09-23 13:00:00',
      externalReference: 'internal-ref',
      futureField: 'ignored',
    },
    anotherFutureField: { anything: true },
  });

  const event = await provider.verifyWebhook({
    headers: { 'asaas-access-token': webhookToken },
    rawBody,
  });

  assert.equal(event.provider, 'asaas');
  assert.equal(event.providerEventId, 'evt_1');
  assert.equal(event.eventName, 'PAYMENT_CONFIRMED');
  assert.equal(event.resourceType, 'payment');
  assert.equal(event.paymentId, 'pay_1');
  assert.equal(event.subscriptionId, 'sub_1');
  assert.equal(event.customerId, 'cus_1');
  assert.equal(event.amountCents, 2999);
  assert.equal(event.currency, 'BRL');
  assert.equal(event.verified, true);
  assert.equal(event.verificationMode, 'verified_webhook_token');
  assert.match(event.sanitizedPayloadHash, /^[a-f0-9]{64}$/);
  assert.equal('futureField' in event, false);
});

test('rejeita token de webhook incorreto', async () => {
  const provider = new AsaasPaymentProvider({
    runtime,
    webhookToken,
  });

  await assert.rejects(
    provider.verifyWebhook({
      headers: {
        'asaas-access-token':
          'fedcba9876543210fedcba9876543210',
      },
      rawBody: JSON.stringify({
        id: 'evt_2',
        event: 'PAYMENT_CONFIRMED',
        payment: { id: 'pay_2', subscription: 'sub_2' },
      }),
    }),
    (error: unknown) =>
      error instanceof HttpsError &&
      error.code === 'permission-denied'
  );
});

test('rejeita configuração de token menor que o mínimo do provider', async () => {
  const provider = new AsaasPaymentProvider({
    runtime,
    webhookToken: 'short-secret',
  });

  await assert.rejects(
    provider.verifyWebhook({
      headers: { 'asaas-access-token': 'short-secret' },
      rawBody: JSON.stringify({
        id: 'evt_3',
        event: 'PAYMENT_CONFIRMED',
        payment: { id: 'pay_3', subscription: 'sub_3' },
      }),
    }),
    (error: unknown) =>
      error instanceof HttpsError &&
      error.code === 'failed-precondition'
  );
});

test('rejeita payload sem recurso financeiro identificável', async () => {
  const provider = new AsaasPaymentProvider({
    runtime,
    webhookToken,
  });

  await assert.rejects(
    provider.verifyWebhook({
      headers: { 'asaas-access-token': webhookToken },
      rawBody: JSON.stringify({
        id: 'evt_4',
        event: 'PAYMENT_CONFIRMED',
        payment: {},
      }),
    }),
    (error: unknown) =>
      error instanceof HttpsError &&
      error.code === 'invalid-argument'
  );
});


test('rejeita usar API key Asaas como token de webhook', async () => {
  const apiKeyLikeToken =
    '$aact_hmlg_0123456789abcdef0123456789abcdef';
  const provider = new AsaasPaymentProvider({
    webhookToken: apiKeyLikeToken,
  });

  await assert.rejects(
    provider.verifyWebhook({
      headers: { 'asaas-access-token': apiKeyLikeToken },
      rawBody: JSON.stringify({
        id: 'evt_5',
        event: 'PAYMENT_CONFIRMED',
        payment: { id: 'pay_5', subscription: 'sub_5' },
      }),
    }),
    (error: unknown) =>
      error instanceof HttpsError &&
      error.code === 'failed-precondition'
  );
});

test('rejeita token de webhook com espaços', async () => {
  const unsafeToken =
    '0123456789abcdef 0123456789abcdef';
  const provider = new AsaasPaymentProvider({
    webhookToken: unsafeToken,
  });

  await assert.rejects(
    provider.verifyWebhook({
      headers: { 'asaas-access-token': unsafeToken },
      rawBody: JSON.stringify({
        id: 'evt_6',
        event: 'PAYMENT_CONFIRMED',
        payment: { id: 'pay_6', subscription: 'sub_6' },
      }),
    }),
    (error: unknown) =>
      error instanceof HttpsError &&
      error.code === 'failed-precondition'
  );
});


test('checkout recorrente usa o link sandbox devolvido pelo Asaas', async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | null = null;

  globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    return new Response(
      JSON.stringify({
        id: 'checkout_sandbox_1',
        link: 'https://sandbox.asaas.com/checkoutSession/show/checkout_sandbox_1',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    );
  }) as typeof fetch;

  try {
    const provider = new AsaasPaymentProvider({
      runtime,
      apiKey: '$aact_hmlg_example_key',
    });
    const result = await provider.createCheckoutSession({
      checkoutSessionId: 'internal_checkout_1',
      buyerUid: 'user-1',
      sellerUid: null,
      scope: 'platform_subscription',
      planSnapshot: {
        id: 'platform_premium_monthly',
        key: 'premium',
        scope: 'platform_subscription',
        title: 'Plano Premium',
        description: 'Plano mensal',
        amountCents: 2999,
        currency: 'BRL',
        interval: 'month',
        active: true,
        grantedRole: 'premium',
        catalogVersion: 1,
        snapshotAt: Date.now(),
      },
      amountCents: 2999,
      currency: 'BRL',
      expiresAt: Date.now() + 30 * 60 * 1_000,
      successUrl: 'https://example.test/success',
      cancelUrl: 'https://example.test/cancel',
      expiredUrl: 'https://example.test/expired',
    });

    assert.equal(
      result.checkoutUrl,
      'https://sandbox.asaas.com/checkoutSession/show/checkout_sandbox_1'
    );
    assert.deepEqual(capturedBody?.['billingTypes'], ['CREDIT_CARD']);
    assert.deepEqual(capturedBody?.['chargeTypes'], ['RECURRENT']);
    assert.equal(capturedBody?.['externalReference'], 'internal_checkout_1');
    assert.equal(
      (capturedBody?.['subscription'] as Record<string, unknown>)['cycle'],
      'MONTHLY'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('checkout sandbox rejeita link retornado fora do host esperado e usa fallback', async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        id: 'checkout_sandbox_2',
        link: 'https://example.com/phishing',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } }
    )) as typeof fetch;

  try {
    const provider = new AsaasPaymentProvider({
      runtime,
      apiKey: '$aact_hmlg_example_key',
    });
    const result = await provider.createCheckoutSession({
      checkoutSessionId: 'internal_checkout_2',
      buyerUid: 'user-2',
      sellerUid: null,
      scope: 'platform_subscription',
      planSnapshot: null,
      amountCents: 1999,
      currency: 'BRL',
      expiresAt: Date.now() + 30 * 60 * 1_000,
      successUrl: 'https://example.test/success',
      cancelUrl: 'https://example.test/cancel',
      expiredUrl: 'https://example.test/expired',
    });

    assert.equal(
      result.checkoutUrl,
      'https://sandbox.asaas.com/checkoutSession/show?id=checkout_sandbox_2'
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
