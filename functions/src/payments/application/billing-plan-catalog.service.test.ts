import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PLATFORM_BILLING_CATALOG_VERSION,
  createBillingPlanSnapshot,
  getPlatformPlanByKey,
  listPlatformPlans,
} from './billing-plan-catalog.service';

test('expõe todos os planos ativos pela mesma versão canônica', () => {
  const plans = listPlatformPlans();

  assert.deepEqual(
    plans.map((plan) => plan.key),
    ['basic', 'premium', 'vip']
  );
  assert.ok(
    plans.every(
      (plan) => plan.catalogVersion === PLATFORM_BILLING_CATALOG_VERSION
    )
  );
});

test('lookup e listagem usam o mesmo preço canônico', () => {
  for (const plan of listPlatformPlans()) {
    assert.deepEqual(getPlatformPlanByKey(plan.key), plan);
  }
});

test('snapshot financeiro preserva o valor e a versão aceitos no checkout', () => {
  const plan = getPlatformPlanByKey('premium');
  assert.ok(plan);

  const snapshot = createBillingPlanSnapshot(plan, 1_800_000_000_000);

  assert.equal(snapshot.amountCents, plan.amountCents);
  assert.equal(snapshot.currency, plan.currency);
  assert.equal(snapshot.catalogVersion, PLATFORM_BILLING_CATALOG_VERSION);
  assert.equal(snapshot.snapshotAt, 1_800_000_000_000);
});
