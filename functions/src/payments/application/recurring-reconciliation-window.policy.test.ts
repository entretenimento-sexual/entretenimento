import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROVIDER_WEBHOOK_PROCESSING_LEASE_MS,
  compareEligibleAt,
  isProviderWebhookDue,
  isRecurringCancellationDue,
  providerWebhookEligibilityAt,
  recurringCancellationEligibilityAt,
} from './recurring-reconciliation-window.policy';

test('pending webhook fica elegível pela criação', () => {
  assert.equal(
    providerWebhookEligibilityAt({
      processingStatus: 'pending',
      createdAt: 100,
      receivedAt: 90,
      nextAttemptAt: null,
      lastAttemptAt: null,
    }),
    100
  );
});

test('retry respeita nextAttemptAt e não roda antes do vencimento', () => {
  const event = {
    processingStatus: 'retry' as const,
    createdAt: 100,
    receivedAt: 90,
    nextAttemptAt: 500,
    lastAttemptAt: 200,
  };

  assert.equal(providerWebhookEligibilityAt(event), 500);
  assert.equal(isProviderWebhookDue(event, 499), false);
  assert.equal(isProviderWebhookDue(event, 500), true);
});

test('processing só volta após expiração do lease', () => {
  const event = {
    processingStatus: 'processing' as const,
    createdAt: 100,
    receivedAt: 90,
    nextAttemptAt: null,
    lastAttemptAt: 1_000,
  };

  assert.equal(
    providerWebhookEligibilityAt(event),
    1_000 + PROVIDER_WEBHOOK_PROCESSING_LEASE_MS
  );
  assert.equal(
    isProviderWebhookDue(
      event,
      1_000 + PROVIDER_WEBHOOK_PROCESSING_LEASE_MS - 1
    ),
    false
  );
  assert.equal(
    isProviderWebhookDue(
      event,
      1_000 + PROVIDER_WEBHOOK_PROCESSING_LEASE_MS
    ),
    true
  );
});

test('cancelamento recorrente sem nextAttemptAt é tratado como legado vencido', () => {
  const contract = {
    needsProviderCancellation: true,
    providerCancellationNextAttemptAt: null,
  };

  assert.equal(recurringCancellationEligibilityAt(contract), 0);
  assert.equal(isRecurringCancellationDue(contract, 1), true);
});

test('cancelamento futuro não é selecionado antes da hora', () => {
  const contract = {
    needsProviderCancellation: true,
    providerCancellationNextAttemptAt: 5_000,
  };

  assert.equal(isRecurringCancellationDue(contract, 4_999), false);
  assert.equal(isRecurringCancellationDue(contract, 5_000), true);
});

test('ordenação usa instante elegível e id como desempate', () => {
  assert.ok(compareEligibleAt(100, 200, 'b', 'a') < 0);
  assert.ok(compareEligibleAt(100, 100, 'a', 'b') < 0);
});
