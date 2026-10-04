// scripts/quality/check-promotion-compliance-boundary.mjs
// -----------------------------------------------------------------------------
// PROMOTION / BOOST COMPLIANCE BOUNDARY
// -----------------------------------------------------------------------------
// Garante snapshot auditável de advertiser/creative/targeting/delivery/payment/
// retention, com minimização de dados e retenção mínima de um ano-calendário
// após o fim da veiculação. Official Media Context permanece ortogonal.
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
    throw new Error('[promotion-compliance] ' + label + ': ' + fragment);
  }
}

function forbidIncludes(source, fragment, label) {
  if (source.includes(fragment)) {
    throw new Error('[promotion-compliance] ' + label + ': ' + fragment);
  }
}

const policy = read(
  'functions/src/promotion-boost/promotion-boost-compliance-snapshot.policy.ts'
);

for (const fragment of [
  "PROMOTION_COMPLIANCE_POLICY_VERSION =",
  "'BR_ADS_2026_09_V1'",
  "'DECRETO_12975_2026_ART_16_K'",
  "'DECRETO_12975_2026_ART_16_M'",
  "'DECRETO_12975_2026_ART_16_N'",
  "'CDC_ART_36_38'",
  "'LGPD_ART_6'",
  "'ECA_DIGITAL_ART_22_23'",
  "'DECRETO_12880_2026_ART_31_33'",
  "'CONAR_CODIGO_E_GUIA_DIGITAL_2026_09'",
  'PromotionComplianceAdvertiserSnapshot',
  'PromotionComplianceCreativeSnapshot',
  'PromotionComplianceTargetingSnapshot',
  'PromotionComplianceDeliveryPolicySnapshot',
  'PromotionCompliancePaymentSnapshot',
  'PromotionComplianceRetentionSnapshot',
  "audience: 'verified_adults_only'",
  'childOrTeenProfilingAllowed: false',
  'profileBasedAdvertising: false',
  'emotionalAnalysis: false',
  'sensitivePersonalDataTargeting: false',
  "disclosure: 'Patrocinado'",
  'paidPlacementSeparatedFromOrganicScore: true',
  'rawCreativeRetained: false',
  'privacyMinimized: true',
  'automaticDeletionBeforeRetainUntil: false',
  'date.setUTCFullYear(date.getUTCFullYear() + 1)',
  'creativeFingerprintSha256',
  'viewerHash: string',
  'buildPromotionComplianceDeliveryEvidence',
]) {
  requireIncludes(policy, fragment, 'canonical snapshot drift');
}

for (const forbidden of [
  'readonly viewerUid:',
  'officialMediaContext',
  'officialPhoto',
  'dateOfBirth',
  'birthDate',
  'cpf',
]) {
  forbidIncludes(policy, forbidden, 'privacy/orthogonality drift');
}

const photoManager = read(
  'functions/src/promotion-boost/manage-photo-promotion-campaign.handler.ts'
);
for (const fragment of [
  'buildPromotionComplianceCreativeSnapshot',
  'buildPromotionComplianceSnapshot',
  "collection('promotion_boost_compliance_snapshots')",
  'complianceSnapshotId: complianceSnapshot.snapshotId',
  'complianceRetentionReviewAt:',
]) {
  requireIncludes(photoManager, fragment, 'photo campaign snapshot drift');
}

const communityManager = read(
  'functions/src/community-boost/manage-community-boost-campaign.handler.ts'
);
for (const fragment of [
  'buildPromotionComplianceCreativeSnapshot',
  'buildPromotionComplianceSnapshot',
  "collection('promotion_boost_compliance_snapshots')",
  "targetType: 'community'",
  'complianceSnapshotId: complianceSnapshot.snapshotId',
  'complianceRetentionReviewAt:',
]) {
  requireIncludes(communityManager, fragment, 'community campaign snapshot drift');
}

const photoPlacementHandler = read(
  'functions/src/promotion-boost/get-photo-promotion-placement.handler.ts'
);
requireIncludes(
  photoPlacementHandler,
  'assertPlatformAccountAccessData',
  'photo sponsored delivery must remain account-gated'
);

const communityPlacementHandler = read(
  'functions/src/community-boost/get-community-boost-placement.handler.ts'
);
requireIncludes(
  communityPlacementHandler,
  'assertCommunitySocialAccessForUid',
  'community sponsored delivery must remain adult-gated'
);

for (const [relativePath, label] of [
  [
    'functions/src/promotion-boost/photo-promotion-selection.service.ts',
    'photo delivery evidence drift',
  ],
  [
    'functions/src/community-boost/community-boost-selection.service.ts',
    'community delivery evidence drift',
  ],
]) {
  const source = read(relativePath);
  for (const fragment of [
    'buildPromotionComplianceDeliveryEvidence',
    "stoppedReason: 'compliance_snapshot_required'",
    'complianceSnapshotId: complianceId',
    'compliance: deliveryCompliance',
    'complianceRetentionReviewAt: deliveryCompliance.retainUntil',
    "collection('promotion_boost_billing_events')",
    'viewerHash',
  ]) {
    requireIncludes(source, fragment, label);
  }
}

const complianceCollectionWriters = [
  'functions/src/promotion-boost/manage-photo-promotion-campaign.handler.ts',
  'functions/src/community-boost/manage-community-boost-campaign.handler.ts',
];

for (const relativePath of complianceCollectionWriters) {
  const source = read(relativePath);
  requireIncludes(
    source,
    "collection('promotion_boost_compliance_snapshots')",
    relativePath + ' must write canonical compliance snapshot'
  );
  requireIncludes(
    source,
    'transaction.create(',
    relativePath + ' compliance snapshot must be create-only'
  );
}

for (const directory of [
  path.join(root, 'functions', 'src', 'promotion-boost'),
  path.join(root, 'functions', 'src', 'community-boost'),
]) {
  for (const entry of fs.readdirSync(directory)) {
    if (
      !entry.endsWith('.ts')
      || entry.endsWith('.spec.ts')
      || entry.endsWith('.test.ts')
    ) {
      continue;
    }

    const absolute = path.join(directory, entry);
    const relative = path.relative(root, absolute).replaceAll('\\', '/');
    const source = fs.readFileSync(absolute, 'utf8');

    if (!source.includes('promotion_boost_compliance_snapshots')) continue;
    if (!complianceCollectionWriters.includes(relative)) {
      throw new Error(
        '[promotion-compliance] unexpected compliance snapshot writer/reader: ' +
          relative
      );
    }

    const directMutableComplianceWrite =
      /collection\('promotion_boost_compliance_snapshots'\)\s*\.doc\([^)]*\)\s*\.(?:set|update|delete)\(/m;
    if (directMutableComplianceWrite.test(source)) {
      throw new Error(
        '[promotion-compliance] snapshot must remain immutable/create-only: ' +
          relative
      );
    }
  }
}

const rules = read('firestore-rules/promotion_boost.rules');
requireIncludes(
  rules,
  'match /promotion_boost_compliance_snapshots/{campaignId}',
  'compliance collection must be backend-only'
);
requireIncludes(
  rules,
  'allow read, write: if false;',
  'compliance collection must deny client authority'
);

console.log(
  '[promotion-compliance] OK: advertiser/creative/targeting/delivery/payment/retention snapshot is versioned, privacy-minimized, account-gated and backend-only.'
);
