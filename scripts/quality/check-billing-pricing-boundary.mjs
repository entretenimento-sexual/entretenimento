// scripts/quality/check-billing-pricing-boundary.mjs
// Garante fonte única de preço para assinatura da plataforma sem congelar valores
// comerciais específicos. O objetivo é impedir duplicação de preço no frontend e
// preservar a relação catálogo -> snapshot -> checkout -> settlement.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function requireIncludes(source, fragment, label) {
  if (!source.includes(fragment)) {
    throw new Error('[billing-pricing-boundary] ' + label);
  }
}

const catalog = read(
  'functions/src/payments/application/billing-plan-catalog.service.ts'
);
for (const fragment of [
  'PLATFORM_BILLING_CATALOG_VERSION',
  'const PLATFORM_PLANS',
  'listPlatformPlans',
  'createBillingPlanSnapshot',
  'amountCents:',
  "currency: 'BRL'",
  "interval: 'month'",
]) {
  requireIncludes(catalog, fragment, 'canonical catalog drift: ' + fragment);
}

const catalogHandler = read(
  'functions/src/payments/application/get-platform-plans.handler.ts'
);
for (const fragment of [
  'listPlatformPlans',
  'PLATFORM_BILLING_CATALOG_VERSION',
  'amountCents: plan.amountCents',
  'currency: plan.currency',
  'interval: plan.interval',
  'catalogVersion: plan.catalogVersion',
]) {
  requireIncludes(
    catalogHandler,
    fragment,
    'public catalog must project canonical financial fields: ' + fragment
  );
}

const checkout = read(
  'functions/src/payments/application/create-platform-checkout-session.handler.ts'
);
for (const fragment of [
  'requirePlatformPlanByKey',
  'createBillingPlanSnapshot',
  'resolvePlatformCheckoutPriceLockExpiresAt',
  'amountCents: planSnapshot.amountCents',
  'currency: planSnapshot.currency',
  'catalogVersion: planSnapshot.catalogVersion',
  'priceTreatment: planChangePolicy.priceTreatment',
  'periodTreatment: planChangePolicy.periodTreatment',
  'prorationSupported: planChangePolicy.prorationSupported',
]) {
  requireIncludes(
    checkout,
    fragment,
    'checkout must remain bound to canonical snapshot: ' + fragment
  );
}

const settlement = read(
  'functions/src/payments/application/payment-settlement.service.ts'
);
for (const fragment of [
  'assertCheckoutMatchesEvent',
  'isPlatformCheckoutPriceLockActive',
  "reason: 'checkout_price_lock_expired'",
  'resolvePlatformSubscriptionSettlementPeriod',
]) {
  requireIncludes(
    settlement,
    fragment,
    'settlement price/period boundary drift: ' + fragment
  );
}

const lifecycle = read(
  'functions/src/payments/application/platform-subscription-change.policy.ts'
);
for (const fragment of [
  "'current_catalog_snapshot_full_period'",
  "'extend_from_current_end'",
  "'upgrade_after_payment'",
  'prorationSupported: false',
  "'downgrade_blocked'",
]) {
  requireIncludes(
    lifecycle,
    fragment,
    'subscription lifecycle semantics drift: ' + fragment
  );
}

function walkFiles(relativeDir) {
  const absoluteDir = path.join(root, relativeDir);
  if (!fs.existsSync(absoluteDir)) return [];

  return fs.readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) return walkFiles(relativePath);
    return [relativePath];
  });
}

const subscriptionPricingSurfaceFiles = [
  ...walkFiles('src/app/subscriptions'),
  ...walkFiles('src/app/payments-core'),
  ...walkFiles('src/app/account/pages/account-subscription'),
].filter(
  (file) =>
    (file.endsWith('.ts') || file.endsWith('.html'))
    && !file.endsWith('.spec.ts')
);

for (const file of subscriptionPricingSurfaceFiles) {
  const source = read(file);
  if (/R\$\s*\d/.test(source)) {
    throw new Error(
      '[billing-pricing-boundary] hardcoded BRL amount outside canonical catalog: '
      + file
    );
  }
}

const planUi = read(
  'src/app/subscriptions/subscription-plan/subscription-plan.component.ts'
);
for (const fragment of [
  'getPlatformPlans$()',
  'plan.amountCents / 100',
  "currency: plan.currency",
]) {
  requireIncludes(
    planUi,
    fragment,
    'subscription UI must consume canonical catalog: ' + fragment
  );
}

if (/R\$\s*\d/.test(planUi) || /priceLabel\s*:\s*['"]R\$/.test(planUi)) {
  throw new Error(
    '[billing-pricing-boundary] subscription plan UI must not hardcode monetary values'
  );
}

const planTemplate = read(
  'src/app/subscriptions/subscription-plan/subscription-plan.component.html'
);
if (/R\$\s*\d/.test(planTemplate)) {
  throw new Error(
    '[billing-pricing-boundary] subscription plan template must not hardcode monetary values'
  );
}
requireIncludes(
  planTemplate,
  '(plans$ | async)',
  'subscription plan template must render canonical observable catalog'
);


const checkoutTemplate = read(
  'src/app/subscriptions/checkout/checkout.component.html'
);
requireIncludes(
  checkoutTemplate,
  "currency:plan.currency",
  'checkout currency must come from canonical plan'
);
if (checkoutTemplate.includes("currency:'BRL'")) {
  throw new Error(
    '[billing-pricing-boundary] checkout must not hardcode BRL instead of plan.currency'
  );
}

const repository = read(
  'src/app/payments-core/infrastructure/repositories/billing.repository.ts'
);
for (const fragment of [
  "'getPlatformPlans'",
  'getPlatformPlans$()',
  "'getPlatformPlanByKey'",
]) {
  requireIncludes(
    repository,
    fragment,
    'Angular billing repository canonical catalog drift: ' + fragment
  );
}

console.log(
  '[billing-pricing-boundary] OK: pricing is canonical, UI has no duplicated monetary values, and paid-time semantics remain explicit.'
);
