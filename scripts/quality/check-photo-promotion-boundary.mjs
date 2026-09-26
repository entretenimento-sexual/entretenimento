// scripts/quality/check-photo-promotion-boundary.mjs
// -----------------------------------------------------------------------------
// PHOTO PROMOTION / ORGANIC RANKING BOUNDARY
// -----------------------------------------------------------------------------
// Guarantees:
// - paid promotion is served only through promotion_boost placement;
// - organic ranking contracts do not carry billing/boost fields;
// - sponsored photo state is not persisted in SWR snapshots;
// - official verification and paid promotion remain independent.
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
    throw new Error('[photo-promotion-boundary] ' + label + ': ' + fragment);
  }
}

function forbidIncludes(source, fragment, label) {
  if (source.includes(fragment)) {
    throw new Error('[photo-promotion-boundary] ' + label + ': ' + fragment);
  }
}

const rankingPaths = [
  'src/app/core/interfaces/media/i-public-photo-ranking.ts',
  'src/app/core/services/media/public-photo-ranking-query.service.ts',
  'src/app/core/services/media/public-photo-ranking-firestore.gateway.ts',
  'functions/src/media/application/get-public-media-discovery.handler.ts',
];

for (const relativePath of rankingPaths) {
  const source = read(relativePath);
  for (const forbidden of [
    'boostActive',
    'boostPriority',
    'boostedUntil',
    'PROMOTION_BOOST',
    'promotion_boost',
    'rateCpmCents',
    'budgetCents',
    'spentMilliCents',
  ]) {
    forbidIncludes(
      source,
      forbidden,
      relativePath + ' must remain financially neutral'
    );
  }
}

const publicPhotoContract = read(
  'src/app/core/interfaces/media/i-public-photo-item.ts'
);
for (const forbidden of ['boostActive', 'boostPriority', 'boostedUntil']) {
  forbidIncludes(
    publicPhotoContract,
    forbidden,
    'public photo projection must not be promotion authority'
  );
}
requireIncludes(
  publicPhotoContract,
  'officialPhoto?: IOfficialPhotoProjection | null;',
  'official photo identity projection must remain explicit'
);
forbidIncludes(
  publicPhotoContract,
  'promotionPlacement',
  'ephemeral placement must not enter persistent photo projection'
);

const feed = read(
  'src/app/core/services/media/public-photo-discovery-feed.service.ts'
);
requireIncludes(
  feed,
  'sponsoredPlacement: PhotoPromotionPlacement | null;',
  'organic feed must carry sponsored placement separately'
);
requireIncludes(
  feed,
  'this.promotion.loadPlacement$(items)',
  'sponsored selection must happen after organic page resolution'
);
forbidIncludes(
  feed,
  'this.snapshots.write(this.snapshotKind(mode), [',
  'sponsored placement must never be written into organic snapshot'
);

const snapshot = read(
  'src/app/core/services/media/public-media-snapshot.service.ts'
);
forbidIncludes(
  snapshot,
  'boosted-photos',
  'sponsored content must not have persistent SWR snapshot'
);

const promotionSelection = read(
  'functions/src/promotion-boost/photo-promotion-selection.service.ts'
);
for (const fragment of [
  "disclosure: PROMOTION_BOOST_DISCLOSURE",
  "billingReason: 'served_placement'",
  'promotion_boost_frequency_caps',
  "collection('billing_ledger')",
  'ledgerOwnershipTransferred: false',
  'rateCpmCentsSnapshot',
  'isPromotionBoostAdvertiserInteractionEligible',
]) {
  requireIncludes(
    promotionSelection,
    fragment,
    'photo promotion billing/frequency/ledger invariant drift'
  );
}

const promotionLifecycle = read(
  'functions/src/promotion-boost/sync-photo-promotion-lifecycle.trigger.ts'
);
for (const fragment of [
  'syncPhotoPromotionFromPublication',
  'syncPhotoPromotionFromAdvertiserAccount',
  'syncPhotoPromotionFromAdvertiserUser',
  'syncPhotoPromotionFromAdvertiserAgeEligibility',
  'photo_promotion_campaign_stopped_by_target_lifecycle',
]) {
  requireIncludes(
    promotionLifecycle,
    fragment,
    'promotion lifecycle fail-closed guard drift'
  );
}

const officialProjection = read(
  'functions/src/media/application/sync-official-photo-projection.trigger.ts'
);
for (const forbidden of [
  'promotion_boost',
  'rateCpmCents',
  'budgetCents',
  'boostActive',
]) {
  forbidIncludes(
    officialProjection,
    forbidden,
    'official photo projection must remain independent from promotion'
  );
}

console.log(
  '[photo-promotion-boundary] OK: paid placement is backend-only, capped, ledgered, lifecycle-aware and isolated from organic score/ranking/snapshots.'
);
