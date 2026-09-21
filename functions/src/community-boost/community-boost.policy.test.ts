import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_BOOST_BILLING_BASIS,
  COMMUNITY_BOOST_CURRENCY,
  buildCommunityBoostCampaign,
  evaluateCommunityBoostPacing,
  isCommunityBoostTargetEligible,
  normalizeCommunityBoostAdvertiserAccount,
  normalizeCommunityBoostBillingConfig,
  orderCommunityBoostRotationCandidates,
  resolveCommunityBoostDay,
} from './community-boost.policy';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1_000;

function billingConfig() {
  return {
    active: true,
    version: 4,
    currency: COMMUNITY_BOOST_CURRENCY,
    rateCpmCents: 850,
    minBudgetCents: 1_000,
    maxBudgetCents: 500_000,
    updatedAt: NOW - 1_000,
    updatedBy: 'admin-1',
  } as const;
}

function campaign(overrides: Record<string, unknown> = {}) {
  const built = buildCommunityBoostCampaign({
    campaignId: 'campaign-1',
    communityId: 'community-1',
    ownerUid: 'owner-1',
    targetSourceType: 'community',
    targetTagId: null,
    budgetCents: 10_000,
    dailyBudgetCents: 2_000,
    startsAt: NOW,
    endsAt: NOW + 5 * DAY,
    frequencyCapPerViewerPerDay: 3,
    billingConfig: billingConfig(),
    now: NOW,
  });
  assert.ok(built);
  return { ...built, ...overrides };
}

test('configuração comercial é backend-only e explicitamente versionada', () => {
  assert.deepEqual(
    normalizeCommunityBoostBillingConfig(billingConfig()),
    billingConfig()
  );

  assert.equal(
    normalizeCommunityBoostBillingConfig({
      ...billingConfig(),
      active: false,
    }),
    null
  );
});

test('elegibilidade anunciante é distinta de plano e preço', () => {
  const account = normalizeCommunityBoostAdvertiserAccount({
    policyVersion: 1,
    advertiserUid: 'owner-1',
    active: true,
    billingMode: 'postpaid',
    currency: 'BRL',
    maxCampaignBudgetCents: 25_000,
    createdAt: NOW - 10_000,
    updatedAt: NOW - 1_000,
    updatedBy: 'admin-1',
  }, 'owner-1');

  assert.ok(account);
  assert.equal(account.maxCampaignBudgetCents, 25_000);
  assert.equal('planKey' in account, false);
  assert.equal('rateCpmCents' in account, false);
  assert.equal('officialAssociationKey' in account, false);
});

test('campanha recebe snapshot de faturamento sem alterar score orgânico', () => {
  const value = campaign();

  assert.equal(value.billingBasis, COMMUNITY_BOOST_BILLING_BASIS);
  assert.equal(value.rateCpmCentsSnapshot, 850);
  assert.equal(value.billingConfigVersion, 4);
  assert.equal('discoveryScore' in value, false);
  assert.equal('rankScore' in value, false);
  assert.equal('rankingCandidate' in value, false);
});

test('frequency cap é explícito e limitado pela policy patrocinada', () => {
  const valid = buildCommunityBoostCampaign({
    campaignId: 'campaign-cap',
    communityId: 'community-1',
    ownerUid: 'owner-1',
    targetSourceType: 'community',
    targetTagId: null,
    budgetCents: 10_000,
    dailyBudgetCents: 1_000,
    startsAt: NOW,
    endsAt: NOW + DAY,
    frequencyCapPerViewerPerDay: 3,
    billingConfig: billingConfig(),
    now: NOW,
  });
  assert.equal(valid?.frequencyCapPerViewerPerDay, 3);

  const invalid = buildCommunityBoostCampaign({
    campaignId: 'campaign-cap-invalid',
    communityId: 'community-1',
    ownerUid: 'owner-1',
    targetSourceType: 'community',
    targetTagId: null,
    budgetCents: 10_000,
    dailyBudgetCents: null,
    startsAt: NOW,
    endsAt: NOW + DAY,
    frequencyCapPerViewerPerDay: 11,
    billingConfig: billingConfig(),
    now: NOW,
  });
  assert.equal(invalid, null);
});

test('alternância prioriza menor frequência visual antes do pacing', () => {
  const ordered = orderCommunityBoostRotationCandidates([
    {
      campaignId: 'campaign-a',
      deliveredToday: 2,
      frequencyCapPerViewerPerDay: 4,
      pacingDebtMilliCents: 10_000,
      rateCpmCentsSnapshot: 1_000,
      stableRotationKey: 'a',
    },
    {
      campaignId: 'campaign-b',
      deliveredToday: 0,
      frequencyCapPerViewerPerDay: 4,
      pacingDebtMilliCents: 2_000,
      rateCpmCentsSnapshot: 1_000,
      stableRotationKey: 'b',
    },
    {
      campaignId: 'campaign-c',
      deliveredToday: 1,
      frequencyCapPerViewerPerDay: 4,
      pacingDebtMilliCents: 50_000,
      rateCpmCentsSnapshot: 1_000,
      stableRotationKey: 'c',
    },
  ]);

  assert.deepEqual(
    ordered.map((candidate) => candidate.campaignId),
    ['campaign-b', 'campaign-c', 'campaign-a']
  );
});

test('em empate de frequência, pacing e chave estável resolvem sem aleatoriedade', () => {
  const ordered = orderCommunityBoostRotationCandidates([
    {
      campaignId: 'campaign-a',
      deliveredToday: 0,
      frequencyCapPerViewerPerDay: 3,
      pacingDebtMilliCents: 3_000,
      rateCpmCentsSnapshot: 1_000,
      stableRotationKey: 'z',
    },
    {
      campaignId: 'campaign-b',
      deliveredToday: 0,
      frequencyCapPerViewerPerDay: 3,
      pacingDebtMilliCents: 5_000,
      rateCpmCentsSnapshot: 1_000,
      stableRotationKey: 'y',
    },
    {
      campaignId: 'campaign-c',
      deliveredToday: 0,
      frequencyCapPerViewerPerDay: 3,
      pacingDebtMilliCents: 5_000,
      rateCpmCentsSnapshot: 1_000,
      stableRotationKey: 'a',
    },
  ]);

  assert.deepEqual(
    ordered.map((candidate) => candidate.campaignId),
    ['campaign-c', 'campaign-b', 'campaign-a']
  );
});

test('pacing distribui orçamento por período e bloqueia quando está adiantado', () => {
  const firstDay = evaluateCommunityBoostPacing({
    campaign: campaign(),
    now: NOW + 60_000,
  });
  assert.equal(firstDay.eligible, true);
  assert.equal(firstDay.targetSpendMilliCents, 2_000_000);

  const ahead = evaluateCommunityBoostPacing({
    campaign: campaign({
      spentMilliCents: 2_000_000,
      dailySpendDay: resolveCommunityBoostDay(NOW),
      dailySpentMilliCents: 1_000_000,
    }),
    now: NOW + 60_000,
  });
  assert.equal(ahead.eligible, false);
  assert.equal(ahead.reason, 'ahead_of_pacing');
});

test('daily budget e budget total falham fechados antes de nova cobrança', () => {
  const day = resolveCommunityBoostDay(NOW);

  const daily = evaluateCommunityBoostPacing({
    campaign: campaign({
      dailySpendDay: day,
      dailySpentMilliCents: 2_000_000,
    }),
    now: NOW + 60_000,
  });
  assert.equal(daily.eligible, false);
  assert.equal(daily.reason, 'daily_budget_exhausted');

  const total = evaluateCommunityBoostPacing({
    campaign: campaign({
      spentMilliCents: 9_999_500,
    }),
    now: NOW + 60_000,
  });
  assert.equal(total.eligible, false);
  assert.equal(total.reason, 'budget_exhausted');
});

test('segmentação patrocinada é separada da lista orgânica entregue', () => {
  const base = campaign({ targetTagId: 'intent:dating' });

  assert.equal(
    isCommunityBoostTargetEligible({
      campaign: base,
      sourceType: 'community',
      tagId: 'intent:dating',
      excludedCommunityIds: new Set(),
    }),
    true
  );

  assert.equal(
    isCommunityBoostTargetEligible({
      campaign: base,
      sourceType: 'community',
      tagId: 'intent:dating',
      excludedCommunityIds: new Set(['community-1']),
    }),
    false
  );

  assert.equal(
    isCommunityBoostTargetEligible({
      campaign: base,
      sourceType: 'community',
      tagId: 'intent:friendship',
      excludedCommunityIds: new Set(),
    }),
    false
  );
});

test('dia operacional usa America/Sao_Paulo', () => {
  assert.match(resolveCommunityBoostDay(NOW), /^\d{4}-\d{2}-\d{2}$/);
});
