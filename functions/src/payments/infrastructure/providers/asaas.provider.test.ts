import assert from 'node:assert/strict';
import test from 'node:test';

import { HttpsError } from 'firebase-functions/v2/https';

import { AsaasPaymentProvider } from './asaas.provider';

const runtime = {
  environment: 'sandbox' as const,
  apiBaseUrl: 'https://api-sandbox.asaas.com/v3',
  checkoutBaseUrl: 'https://asaas.com/checkoutSession/show',
  appBaseUrl: 'https://example.test',
};

const webhookToken = '0123456789abcdef0123456789abcdef';

test('verifica webhook Asaas com token separado da API key', async () => {
  const provider = new AsaasPaymentProvider({
    runtime,
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
