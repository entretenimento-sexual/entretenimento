import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PROMOTION_COMPLIANCE_POLICY_VERSION,
  buildPromotionComplianceCreativeSnapshot,
  buildPromotionComplianceDeliveryEvidence,
  buildPromotionComplianceSnapshot,
  promotionComplianceContextTagHash,
  promotionComplianceRetainUntil,
} from './promotion-boost-compliance-snapshot.policy';

const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);
const ENDS_AT = Date.UTC(2026, 9, 31, 23, 0, 0);

function campaign() {
  return {
    campaignId: 'campaign-1',
    targetType: 'photo' as const,
    targetId: 'photo-1',
    targetOwnerUid: 'owner-1',
    advertiserUid: 'owner-1',
    budgetCents: 10_000,
    dailyBudgetCents: 2_000,
    currency: 'BRL' as const,
    billingBasis: 'served_placement_cpm' as const,
    rateCpmCentsSnapshot: 250,
    billingConfigVersion: 4,
    endsAt: ENDS_AT,
    frequencyCapPerViewerPerDay: 3,
  };
}

describe('promotion-boost-compliance-snapshot.policy', () => {
  it('preserva um ano-calendário após o fim da veiculação', () => {
    assert.equal(
      promotionComplianceRetainUntil(ENDS_AT),
      Date.UTC(2027, 9, 31, 23, 0, 0)
    );
  });

  it('gera creative auditável por hash sem reter conteúdo bruto', () => {
    const creative = buildPromotionComplianceCreativeSnapshot({
      targetType: 'photo',
      targetId: 'photo-1',
      targetOwnerUid: 'owner-1',
      rawCreative: {
        assetVersion: 123,
        publishedAt: NOW - 1_000,
        moderationStatus: 'APPROVED',
        visibility: 'PUBLIC',
        caption: 'texto publicitário',
        alt: 'descrição',
      },
    });

    assert.ok(creative);
    assert.equal(creative.rawCreativeRetained, false);
    assert.match(creative.creativeFingerprintSha256, /^[a-f0-9]{64}$/);
    assert.equal(
      Object.hasOwn(creative as unknown as Record<string, unknown>, 'caption'),
      false
    );
  });

  it('snapshot cobre anunciante, creative, targeting, delivery, payment e retention', () => {
    const creative = buildPromotionComplianceCreativeSnapshot({
      targetType: 'photo',
      targetId: 'photo-1',
      targetOwnerUid: 'owner-1',
      rawCreative: {
        assetVersion: 123,
        publishedAt: NOW - 1_000,
        moderationStatus: 'APPROVED',
        visibility: 'PUBLIC',
      },
    });
    assert.ok(creative);

    const snapshot = buildPromotionComplianceSnapshot({
      campaign: campaign(),
      advertiserAccount: {
        policyVersion: 1,
        updatedAt: NOW - 5_000,
        billingMode: 'postpaid',
      },
      advertiserAuthorityRole: 'owner',
      creative,
      targetingMode: 'contextual_feed',
      capturedAt: NOW,
    });

    assert.ok(snapshot);
    assert.equal(snapshot.policyVersion, PROMOTION_COMPLIANCE_POLICY_VERSION);
    assert.equal(snapshot.advertiser.interactionEligible, true);
    assert.equal(snapshot.targeting.audience, 'verified_adults_only');
    assert.equal(snapshot.targeting.childOrTeenProfilingAllowed, false);
    assert.equal(snapshot.targeting.profileBasedAdvertising, false);
    assert.equal(snapshot.targeting.emotionalAnalysis, false);
    assert.equal(snapshot.delivery.disclosure, 'Patrocinado');
    assert.equal(snapshot.delivery.paidPlacementSeparatedFromOrganicScore, true);
    assert.equal(snapshot.payment.billingBasis, 'served_placement_cpm');
    assert.equal(
      snapshot.retention.minimumLegalBasis,
      'DECRETO_12975_2026_ART_16_M'
    );
    assert.match(snapshot.snapshotId, /^[a-f0-9]{64}$/);
  });

  it('hash contextual não armazena tag bruta', () => {
    const hash = promotionComplianceContextTagHash('tag-sensitive-1');
    assert.ok(hash);
    assert.match(hash, /^[a-f0-9]{64}$/);
    assert.notEqual(hash, 'tag-sensitive-1');
  });

  it('delivery usa somente viewerHash e mantém prova financeira server-authoritative', () => {
    const evidence = buildPromotionComplianceDeliveryEvidence({
      snapshotId: 'a'.repeat(64),
      campaign: campaign(),
      placementId: 'placement-1',
      deliveredAt: NOW,
      viewerHash: 'b'.repeat(40),
      frequencyCapDay: '2026-09-28',
      frequencyCapDeliveredCount: 2,
      billedMilliCents: 250,
    });

    assert.ok(evidence);
    assert.equal(evidence.adultEligibilityRevalidated, true);
    assert.equal(evidence.profileBasedAdvertisingUsed, false);
    assert.equal(evidence.emotionalAnalysisUsed, false);
    assert.equal(evidence.billedMilliCents, 250);
    assert.equal(evidence.currency, 'BRL');
    assert.equal(
      Object.hasOwn(evidence as unknown as Record<string, unknown>, 'viewerUid'),
      false
    );
  });
});
