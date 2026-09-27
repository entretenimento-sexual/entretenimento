import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROMOTION_BOOST_BILLING_BASIS,
  PROMOTION_BOOST_CURRENCY,
  buildPromotionBoostCampaign,
  normalizePromotionBoostAdvertiserAccount,
  normalizePromotionBoostBillingConfig,
  normalizePromotionBoostCampaign,
  normalizePromotionBoostTargetType,
  promotionBoostCampaignEligible,
  promotionBoostTargetAvailability,
} from './promotion-boost.policy';

const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);

function billingConfig() {
  return {
    active: true,
    version: 3,
    currency: PROMOTION_BOOST_CURRENCY,
    rateCpmCents: 250,
    minBudgetCents: 1_000,
    maxBudgetCents: 100_000,
    updatedAt: NOW,
    updatedBy: 'platform_admin',
  };
}

test('Promotion/Boost é a autoridade canônica da configuração comercial', () => {
  const normalized = normalizePromotionBoostBillingConfig(billingConfig());

  assert.deepEqual(normalized, billingConfig());
  assert.equal(
    normalizePromotionBoostBillingConfig({
      ...billingConfig(),
      active: false,
    }),
    null
  );
});

test('conta anunciante é validada no núcleo Promotion/Boost', () => {
  const raw = {
    policyVersion: 1,
    advertiserUid: 'advertiser_1',
    active: true,
    billingMode: 'postpaid',
    currency: PROMOTION_BOOST_CURRENCY,
    maxCampaignBudgetCents: 50_000,
    createdAt: NOW - 1_000,
    updatedAt: NOW,
    updatedBy: 'platform_admin',
  };

  assert.deepEqual(
    normalizePromotionBoostAdvertiserAccount(raw, 'advertiser_1'),
    raw
  );
  assert.equal(
    normalizePromotionBoostAdvertiserAccount(raw, 'another_advertiser'),
    null
  );
});

test('campanha de foto mantém billing, budget e frequency cap no domínio patrocinado', () => {
  const campaign = buildPromotionBoostCampaign({
    campaignId: 'campaign_1',
    targetType: 'photo',
    targetId: 'photo_1',
    targetOwnerUid: 'owner_1',
    advertiserUid: 'advertiser_1',
    budgetCents: 10_000,
    dailyBudgetCents: 2_000,
    startsAt: NOW,
    endsAt: NOW + 7 * 24 * 60 * 60 * 1_000,
    frequencyCapPerViewerPerDay: 3,
    billingConfig: billingConfig(),
    now: NOW,
  });

  assert.ok(campaign);
  assert.equal(campaign.targetType, 'photo');
  assert.equal(campaign.currency, PROMOTION_BOOST_CURRENCY);
  assert.equal(campaign.billingBasis, PROMOTION_BOOST_BILLING_BASIS);
  assert.equal(campaign.frequencyCapPerViewerPerDay, 3);
  assert.equal(campaign.spentMilliCents, 0);
  assert.equal(promotionBoostCampaignEligible(campaign, NOW), true);

  assert.equal(
    buildPromotionBoostCampaign({
      campaignId: 'campaign_2',
      targetType: 'photo',
      targetId: 'photo_2',
      targetOwnerUid: 'owner_1',
      advertiserUid: 'advertiser_1',
      budgetCents: 10_000,
      startsAt: NOW,
      endsAt: NOW + 24 * 60 * 60 * 1_000,
      frequencyCapPerViewerPerDay: 11,
      billingConfig: billingConfig(),
      now: NOW,
    }),
    null
  );
});


test('vídeo pertence ao contrato Promotion/Boost, mas permanece indisponível comercialmente', () => {
  assert.equal(normalizePromotionBoostTargetType('video'), 'video');
  assert.deepEqual(
    promotionBoostTargetAvailability('video'),
    {
      targetType: 'video',
      contractSupported: true,
      campaignCreationEnabled: false,
      placementEnabled: false,
      reason: 'observe_only_not_calibrated',
    }
  );

  const videoCampaign = buildPromotionBoostCampaign({
    campaignId: 'campaign_video_1',
    targetType: 'video',
    targetId: 'video_1',
    targetOwnerUid: 'owner_1',
    advertiserUid: 'advertiser_1',
    budgetCents: 10_000,
    dailyBudgetCents: 2_000,
    startsAt: NOW,
    endsAt: NOW + 7 * 24 * 60 * 60 * 1_000,
    frequencyCapPerViewerPerDay: 3,
    billingConfig: billingConfig(),
    now: NOW,
  });

  assert.equal(videoCampaign, null);
});

test('campanha legada/futura de vídeo pode ser normalizada, mas nunca servida enquanto indisponível', () => {
  const raw = {
    policyVersion: 1,
    campaignId: 'campaign_video_stored',
    targetType: 'video',
    targetId: 'video_1',
    targetOwnerUid: 'owner_1',
    advertiserUid: 'advertiser_1',
    status: 'active',
    budgetCents: 10_000,
    dailyBudgetCents: null,
    spentMilliCents: 0,
    dailySpendDay: null,
    dailySpentMilliCents: 0,
    currency: PROMOTION_BOOST_CURRENCY,
    billingBasis: PROMOTION_BOOST_BILLING_BASIS,
    rateCpmCentsSnapshot: 250,
    billingConfigVersion: 3,
    startsAt: NOW,
    endsAt: NOW + 7 * 24 * 60 * 60 * 1_000,
    frequencyCapPerViewerPerDay: 3,
    deliveredCount: 0,
    qualifiedExposureCount: 0,
    clickCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    stoppedAt: null,
    stoppedReason: null,
  };

  const normalized = normalizePromotionBoostCampaign(raw);
  assert.ok(normalized);
  assert.equal(normalized.targetType, 'video');
  assert.equal(promotionBoostCampaignEligible(normalized, NOW), false);
});
