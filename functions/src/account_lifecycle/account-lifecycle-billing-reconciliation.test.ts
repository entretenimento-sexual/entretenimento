import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

function source(relativePath: string): string {
  return readFileSync(
    path.resolve(process.cwd(), 'src', 'account_lifecycle', relativePath),
    'utf8'
  );
}

test('suspension and deletion persist billing obligation with lifecycle state', () => {
  for (const file of [
    'requestSelfSuspension.ts',
    'moderateSuspendAccount.ts',
    'requestAccountDeletion.ts',
    'moderateScheduleDeletion.ts',
  ]) {
    const current = source(file);

    assert.equal(
      current.includes('buildAccountLifecycleBillingCancellationPatch'),
      true,
      `${file} must persist the billing obligation`
    );
    assert.equal(
      current.includes('reconcileAccountLifecycleBillingCancellation'),
      true,
      `${file} must reconcile after the lifecycle transaction`
    );

    const transactionIndex = current.indexOf('await db.runTransaction');
    const reconcileIndex = current.lastIndexOf(
      'reconcileAccountLifecycleBillingCancellation'
    );

    assert.ok(transactionIndex >= 0);
    assert.ok(reconcileIndex > transactionIndex);
  }
});

test('worker scans only durable pending billing obligations', () => {
  const current = source('reconcileAccountLifecycleBilling.ts');

  assert.equal(
    current.includes(".where('billingCancellationPending', '==', true)"),
    true
  );
  assert.equal(
    current.includes('reconcileAccountLifecycleBillingCancellation'),
    true
  );
  assert.equal(current.includes('secrets: [ASAAS_API_KEY]'), true);
});

test('reactivation and deletion undo never re-enable renewal', () => {
  for (const file of [
    'reactivateSelfSuspension.ts',
    'moderateUnsuspendAccount.ts',
    'cancelAccountDeletion.ts',
  ]) {
    const current = source(file);

    assert.equal(
      current.includes('getAccountLifecycleSubscriptionRenewalStatus'),
      true
    );
    assert.equal(current.includes("'pending'"), true);
    assert.equal(current.includes('renewalEnabled: true'), false);
    assert.equal(current.includes('createCheckoutSession'), false);
  }
});

test('account lifecycle billing bridge remains the only subscription-state reader', () => {
  assert.equal(
    source('account-lifecycle-billing.service.ts').includes(
      'PLATFORM_SUBSCRIPTION_STATE_COLLECTION'
    ),
    true
  );

  for (const file of [
    'requestSelfSuspension.ts',
    'moderateSuspendAccount.ts',
    'requestAccountDeletion.ts',
    'moderateScheduleDeletion.ts',
    'reactivateSelfSuspension.ts',
    'moderateUnsuspendAccount.ts',
    'cancelAccountDeletion.ts',
  ]) {
    assert.equal(
      source(file).includes('PLATFORM_SUBSCRIPTION_STATE_COLLECTION'),
      false,
      `${file} must not become a parallel billing-state reader`
    );
  }
});
