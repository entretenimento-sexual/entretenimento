// scripts/quality/check-photo-promotion-boundary.mjs
// -----------------------------------------------------------------------------
// PHOTO PROMOTION / ORGANIC RANKING BOUNDARY
// -----------------------------------------------------------------------------
// Guarantees:
// - paid promotion is served only through promotion_boost placement;
// - organic ranking contracts do not carry billing/boost fields;
// - sponsored photo state is not persisted in SWR snapshots;
// - official verification and paid promotion remain independent;
// - legacy Community Boost storage naming is quarantined behind one adapter.
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

const organicClientPaths = [
  'src/app/explore/services/explore-feed.service.ts',
  'src/app/explore/models/explore-personal-feed.ts',
  'src/app/explore/pages/social-explore-page/social-explore-page.component.ts',
  'src/app/core/services/media/public-photo-continuation.service.ts',
  'src/app/core/interfaces/media/i-public-media-viewer-session.ts',
];

for (const relativePath of organicClientPaths) {
  const source = read(relativePath);
  for (const forbidden of [
    'boostedPhotos',
    'boostActive',
    'boostPriority',
    "'boosted'",
    'fotos-turbinadas',
  ]) {
    forbidIncludes(
      source,
      forbidden,
      relativePath + ' must not restore paid state inside organic media'
    );
  }
}

const photoViewTracking = read(
  'src/app/core/services/media/photo-view-tracking.service.ts'
);
requireIncludes(
  photoViewTracking,
  "| 'sponsored'",
  'photo tracking must identify paid placement explicitly'
);

const videoViewTracking = read(
  'src/app/core/services/media/video-view-tracking.service.ts'
);
for (const forbidden of ["'boosted'", "'sponsored'"]) {
  forbidIncludes(
    videoViewTracking,
    forbidden,
    'photo Promotion/Boost must not leak into video tracking'
  );
}

const principalFeed = read(
  'src/app/dashboard/principal/principal-feed.service.ts'
);
requireIncludes(
  principalFeed,
  'PublicPhotoRankingQueryService',
  'principal feed must use canonical photo ranking boundary'
);
forbidIncludes(
  principalFeed,
  'getLatestPublicPhotos$',
  'retired global photo read must not return'
);

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

const commercialAuthority = read(
  'functions/src/promotion-boost/promotion-boost-commercial-authority.ts'
);
for (const fragment of [
  'promotionBoostBillingConfigRef',
  'promotionBoostAdvertiserAccountRef',
  'normalizePromotionBoostBillingConfig',
  'normalizePromotionBoostAdvertiserAccount',
  'PROMOTION_BOOST_ADVERTISER_ACCOUNT_DOCUMENT',
]) {
  requireIncludes(
    commercialAuthority,
    fragment,
    'canonical Promotion/Boost commercial authority drift'
  );
}

const promotionBackendDir = path.join(
  root,
  'functions/src/promotion-boost'
);
for (const fileName of fs.readdirSync(promotionBackendDir)) {
  if (
    !fileName.endsWith('.ts')
    || fileName === 'promotion-boost-commercial-authority.ts'
  ) {
    continue;
  }

  const relativePath =
    'functions/src/promotion-boost/' + fileName;
  const source = read(relativePath);
  forbidIncludes(
    source,
    '../community-boost/',
    relativePath + ' must not import Community Boost directly'
  );
  forbidIncludes(
    source,
    'community_boost_',
    relativePath + ' must not know legacy Community Boost storage names'
  );
}

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
  'syncPhotoPromotionFromUserLifecycle',
  'syncPhotoPromotionFromAgeEligibility',
  'photo_promotion_campaign_stopped_by_target_lifecycle',
]) {
  requireIncludes(
    promotionLifecycle,
    fragment,
    'promotion lifecycle fail-closed guard drift'
  );
}

const firestoreIndexes = JSON.parse(read('firestore.indexes.json'));
const promotionTtlCollections = new Set(
  (firestoreIndexes.fieldOverrides ?? [])
    .filter((entry) =>
      entry?.fieldPath === 'expiresAt' && entry?.ttl === true
    )
    .map((entry) => entry.collectionGroup)
);
for (const collectionGroup of [
  'promotion_boost_placements',
  'promotion_boost_frequency_caps',
  'promotion_boost_requests',
  'promotion_boost_active_slots',
]) {
  if (!promotionTtlCollections.has(collectionGroup)) {
    throw new Error(
      '[photo-promotion-boundary] ephemeral promotion TTL missing: '
        + collectionGroup
    );
  }
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
  '[photo-promotion-boundary] OK: paid placement is backend-only, capped, ledgered, lifecycle-aware, commercially decoupled and isolated from organic score/ranking/snapshots.'
);
