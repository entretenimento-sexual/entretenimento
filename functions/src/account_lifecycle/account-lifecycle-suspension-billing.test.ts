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

test('self suspension persists account state before stopping recurring billing', () => {
  const current = source('requestSelfSuspension.ts');
  const stateIndex = current.indexOf('await db.runTransaction');
  const billingIndex = current.indexOf(
    'await cancelRecurringBillingForAccountLifecycle'
  );

  assert.ok(stateIndex >= 0);
  assert.ok(billingIndex > stateIndex);
  assert.equal(current.includes('secrets: [ASAAS_API_KEY]'), true);
  assert.equal(
    current.includes("reason: 'account-self-suspension'"),
    true
  );
});

test('moderation suspension persists account state before stopping recurring billing', () => {
  const current = source('moderateSuspendAccount.ts');
  const stateIndex = current.indexOf('await db.runTransaction');
  const billingIndex = current.indexOf(
    'await cancelRecurringBillingForAccountLifecycle'
  );

  assert.ok(stateIndex >= 0);
  assert.ok(billingIndex > stateIndex);
  assert.equal(current.includes('secrets: [ASAAS_API_KEY]'), true);
  assert.equal(
    current.includes("reason: 'moderation-account-suspension'"),
    true
  );
});

test('reactivation never silently re-enables recurring billing', () => {
  for (const file of [
    'reactivateSelfSuspension.ts',
    'moderateUnsuspendAccount.ts',
  ]) {
    const current = source(file);

    assert.equal(
      current.includes('getAccountLifecycleSubscriptionRenewalStatus'),
      true
    );
    assert.equal(current.includes('renewalEnabled: true'), false);
    assert.equal(current.includes('createCheckoutSession'), false);
  }
});

test('account lifecycle billing bridge remains the only subscription-state reader for lifecycle commands', () => {
  const cancellationUndo = source('cancelAccountDeletion.ts');

  assert.equal(
    cancellationUndo.includes(
      'getAccountLifecycleSubscriptionRenewalStatus'
    ),
    true
  );
  assert.equal(
    cancellationUndo.includes('PLATFORM_SUBSCRIPTION_STATE_COLLECTION'),
    false
  );
});
