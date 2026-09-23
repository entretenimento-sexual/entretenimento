// scripts/quality/check-asaas-recurring-billing.mjs
// -----------------------------------------------------------------------------
// Protege a fronteira de cobrança recorrente real.
// Não congela preços nem segredos; impede regressão para checkout simulado,
// webhook não autenticado, cartão no app ou recorrência sem reconciliação.
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function requireIncludes(source, fragment, label) {
  if (!source.includes(fragment)) {
    throw new Error('[asaas-recurring-billing] ' + label + ': ' + fragment);
  }
}

const config = read('functions/src/payments/config/asaas.config.ts');
for (const fragment of [
  "defineSecret('ASAAS_API_KEY')",
  "defineSecret('ASAAS_WEBHOOK_TOKEN')",
  "'https://api.asaas.com/v3'",
  "'https://api-sandbox.asaas.com/v3'",
  "'$aact_prod_'",
  "'$aact_hmlg_'",
  'ASAAS_RECURRING_ENABLED',
]) requireIncludes(config, fragment, 'Asaas config drift');

const provider = read(
  'functions/src/payments/infrastructure/providers/asaas.provider.ts'
);
for (const fragment of [
  "chargeTypes: ['RECURRENT']",
  "billingTypes: ['CREDIT_CARD']",
  "'/checkouts'",
  "'asaas-access-token'",
  'timingSafeEqual',
  'cancelRecurringSubscription',
  '/subscriptions/',
  'input.expiredUrl',
  'input.expiresAt',
]) requireIncludes(provider, fragment, 'Asaas provider drift');

for (const forbidden of [
  'creditCardNumber',
  'creditCard.number',
  'cardNumber',
  'securityCode',
  'cvv',
  'holderInfo',
]) {
  if (provider.toLowerCase().includes(forbidden.toLowerCase())) {
    throw new Error(
      '[asaas-recurring-billing] hosted checkout must keep card data out of backend: '
      + forbidden
    );
  }
}

const checkout = read(
  'functions/src/payments/application/create-platform-checkout-session.handler.ts'
);
for (const fragment of [
  'ASAAS_API_KEY',
  'AsaasPaymentProvider',
  'assertCallableAppCheck',
  'consumeBackendRateLimitQuota',
  'acquirePlatformCheckoutLock',
  'resolveAsaasRuntimeConfig',
  'assertAsaasRecurringCheckoutEnabled',
]) requireIncludes(checkout, fragment, 'production checkout drift');

const webhook = read(
  'functions/src/payments/application/payment-webhook.handler.ts'
);
for (const fragment of [
  'ASAAS_WEBHOOK_TOKEN',
  'persistVerifiedProviderWebhookEvent',
  'provider.verifyWebhook',
]) requireIncludes(webhook, fragment, 'webhook ingress drift');

if (webhook.includes('settleVerifiedPaidEvent(')) {
  throw new Error(
    '[asaas-recurring-billing] public webhook must not settle inline'
  );
}

const processor = read(
  'functions/src/payments/application/provider-webhook-processor.service.ts'
);
for (const fragment of [
  'settleRecurringPlatformSubscriptionPayment',
  'reverseRecurringPlatformSubscriptionPayment',
  'markRecurringSubscriptionPaymentProblem',
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
  'PAYMENT_OVERDUE',
  'PAYMENT_REFUNDED',
  'PAYMENT_CHARGEBACK_REQUESTED',
]) requireIncludes(processor, fragment, 'async webhook processing drift');

const jobs = read(
  'functions/src/payments/application/process-provider-webhook.handler.ts'
);
for (const fragment of [
  'processProviderWebhookEventTrigger',
  'reconcileProviderWebhookEvents',
  'reconcileRecurringProviderCancellations',
  'secrets: [ASAAS_API_KEY]',
]) requireIncludes(jobs, fragment, 'recurring worker drift');

const cancel = read(
  'functions/src/payments/application/cancel-platform-subscription-renewal.handler.ts'
);
for (const fragment of [
  'requestRecurringContractCancellation',
  'cancelRecurringContractAtProvider',
  'accessEndsAt',
  'assertCallableAppCheck',
]) requireIncludes(cancel, fragment, 'cancel-renewal drift');

const accountDeletion = read(
  'functions/src/account_lifecycle/requestAccountDeletion.ts'
);
requireIncludes(
  accountDeletion,
  'requestRecurringContractCancellation',
  'account deletion must stop future recurring charges'
);

const rules = read('firestore-rules/billing.rules');
for (const collection of [
  'provider_webhook_events',
  'platform_subscription_state',
  'platform_subscription_checkout_locks',
  'subscriptions',
]) {
  requireIncludes(
    rules,
    `match /${collection}/`,
    'backend-only billing collection missing from rules'
  );
}

const exports = read('functions/src/payments/index.ts');
for (const symbol of [
  'cancelPlatformSubscriptionRenewal',
  'processProviderWebhookEventTrigger',
  'reconcileProviderWebhookEvents',
  'reconcileRecurringProviderCancellations',
]) requireIncludes(exports, symbol, 'recurring handler export missing');

console.log(
  '[asaas-recurring-billing] OK: hosted recurring checkout, authenticated inbox, async settlement, retries, cancellation and backend-only state are enforced.'
);
