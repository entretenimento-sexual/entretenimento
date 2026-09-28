// scripts/quality/check-promotion-commercial-abuse-boundary.mjs
// -----------------------------------------------------------------------------
// PROMOTION / BOOST COMMERCIAL ABUSE BOUNDARY
// -----------------------------------------------------------------------------
// Billing compra placement backend-only. Não existe wallet, saldo transferível,
// payout ou transferência peer-to-peer. Autoridade, velocity, ledger e fraude
// permanecem revalidados no backend. Vídeo segue desabilitado.
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function requireIncludes(source, fragment, label) {
  if (!source.includes(fragment)) {
    throw new Error('[promotion-commercial-abuse] ' + label + ': ' + fragment);
  }
}

function forbidIncludes(source, fragment, label) {
  if (source.includes(fragment)) {
    throw new Error('[promotion-commercial-abuse] ' + label + ': ' + fragment);
  }
}

const policy = read(
  'functions/src/promotion-boost/promotion-boost.policy.ts'
);
for (const fragment of [
  "PROMOTION_BOOST_BILLING_BASIS =",
  "'served_placement_cpm'",
  "billingMode: 'postpaid'",
  "targetType === 'video'",
  'campaignCreationEnabled: false',
  'placementEnabled: false',
]) {
  requireIncludes(policy, fragment, 'core commercial contract drift');
}

const abuse = read(
  'functions/src/promotion-boost/promotion-boost-abuse.policy.ts'
);
for (const fragment of [
  'PROMOTION_BOOST_CAMPAIGN_MUTATION_RATE_LIMIT',
  'PROMOTION_BOOST_EVENT_RATE_LIMIT',
  'isPromotionBoostSelfInteraction',
  'isPromotionBoostEventTimingPlausible',
]) {
  requireIncludes(abuse, fragment, 'abuse policy drift');
}

const authority = read(
  'functions/src/promotion-boost/promotion-boost-commercial-authority.ts'
);
for (const fragment of [
  'resolvePhotoPromotionAdvertiserAuthority',
  'input.advertiserUid !== input.targetOwnerUid',
  'normalizePromotionBoostAdvertiserAccount',
]) {
  requireIncludes(authority, fragment, 'advertiser authority drift');
}

const manager = read(
  'functions/src/promotion-boost/manage-photo-promotion-campaign.handler.ts'
);
for (const fragment of [
  'consumeBackendRateLimitQuota',
  'PROMOTION_BOOST_CAMPAIGN_MUTATION_RATE_LIMIT',
  'resolvePhotoPromotionAdvertiserAuthority',
  'ownerUid !== actor.uid',
]) {
  requireIncludes(manager, fragment, 'campaign mutation guard drift');
}

const selection = read(
  'functions/src/promotion-boost/photo-promotion-selection.service.ts'
);
for (const fragment of [
  'resolvePhotoPromotionAdvertiserAuthority',
  'promotion_boost_frequency_caps',
  "collection('billing_ledger')",
  "collection('promotion_boost_billing_events')",
  'transaction.create(',
  "billingReason: 'served_placement'",
  "reason: 'served_placement'",
  'ledgerOwnershipTransferred: false',
]) {
  requireIncludes(selection, fragment, 'billing delivery/ledger drift');
}

const eventHandler = read(
  'functions/src/promotion-boost/record-photo-promotion-event.handler.ts'
);
for (const fragment of [
  'PROMOTION_BOOST_EVENT_RATE_LIMIT',
  'isPromotionBoostSelfInteraction',
  'isPromotionBoostEventTimingPlausible',
  'recordPromotionBoostFraudSignal',
  'incrementPromotionBoostFraudCounter',
  "'self_interaction'",
  "'event_too_fast'",
  "'event_velocity_exceeded'",
]) {
  requireIncludes(eventHandler, fragment, 'event antifraud drift');
}
for (const forbidden of [
  "collection('billing_ledger')",
  "collection('promotion_boost_billing_events')",
  'spentMilliCents',
  'dailySpentMilliCents',
]) {
  forbidIncludes(
    eventHandler,
    forbidden,
    'client-reported events must remain financially neutral'
  );
}

const rules = read('firestore-rules/promotion_boost.rules');
for (const collection of [
  'promotion_boost_campaigns',
  'promotion_boost_placements',
  'promotion_boost_frequency_caps',
  'promotion_boost_billing_events',
  'promotion_boost_fraud_signals',
  'promotion_boost_fraud_counters',
]) {
  requireIncludes(
    rules,
    `match /${collection}/`,
    collection + ' backend-only rule missing'
  );
}
requireIncludes(
  rules,
  'allow read, write: if false;',
  'promotion financial/fraud state must stay backend-only'
);

const indexes = JSON.parse(read('firestore.indexes.json'));
const ttlCollections = new Set(
  (indexes.fieldOverrides ?? [])
    .filter((entry) => entry?.fieldPath === 'expiresAt' && entry?.ttl === true)
    .map((entry) => entry.collectionGroup)
);
for (const collection of [
  'promotion_boost_placements',
  'promotion_boost_frequency_caps',
  'promotion_boost_requests',
  'promotion_boost_active_slots',
  'promotion_boost_fraud_signals',
  'promotion_boost_fraud_counters',
]) {
  if (!ttlCollections.has(collection)) {
    throw new Error(
      '[promotion-commercial-abuse] TTL ausente: ' + collection
    );
  }
}

const promotionDir = path.join(root, 'functions', 'src', 'promotion-boost');
const forbiddenMoneyPrimitives = [
  'promotion_boost_wallet',
  'walletBalance',
  'transferableBalance',
  'withdrawBalance',
  'withdrawFunds',
  'payoutAccount',
  'peerTransfer',
  'transferFunds',
];

for (const fileName of fs.readdirSync(promotionDir)) {
  if (!fileName.endsWith('.ts')) continue;
  const source = read('functions/src/promotion-boost/' + fileName);

  for (const forbidden of forbiddenMoneyPrimitives) {
    forbidIncludes(
      source,
      forbidden,
      fileName + ' must not implement wallet/transfer/payout primitives'
    );
  }
}

console.log(
  '[promotion-commercial-abuse] OK: billing backend-only, advertiser authority, velocity, immutable placement ledger and antifraud are enforced; video remains disabled.'
);
