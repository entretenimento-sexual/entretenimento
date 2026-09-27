import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROMOTION_BOOST_BILLING_BASIS,
  PROMOTION_BOOST_CURRENCY,
  buildPromotionBoostCampaign,
  normalizePromotionBoostAdvertiserAccount,
  normalizePromotionBoostBillingConfig,
  promotionBoostCampaignEligible,
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
