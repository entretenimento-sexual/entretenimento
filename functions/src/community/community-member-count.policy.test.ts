import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeCommunityMemberCount,
  resolveCommunityMemberCountDelta,
} from './community-member-count.policy';
import {
  evaluateCommunityCapacity,
  isCommunityMemberLimitAllowed,
  normalizeCommunityMemberLimit,
  resolveCommunityCapacitySponsorRole,
  resolveCommunityCreationCapability,
  resolveCommunityMemberLimitCapabilityOptions,
  resolveCommunityMemberLimitOptions,
  resolveCommunityMemberLimitRequirement,
  resolvePersonalCommunityCreationPolicy,
  resolveRecommendedCommunityUpgradeRole,
} from './community-capacity.policy';
import { evaluateCommunityCapacityForOwner } from './community-capacity.service';
import {
  evaluateOfficialSpaceCreationGrant,
} from './community-official-space.policy';

const OFFICIAL_SPACE_NOW = 1_800_000_000_000;

const ALL_CAPACITY_OPTIONS = [
  { memberLimit: 25, requirement: 'basic', allowed: false },
  { memberLimit: 50, requirement: 'basic', allowed: false },
  { memberLimit: 100, requirement: 'basic', allowed: false },
  { memberLimit: 250, requirement: 'premium', allowed: false },
  { memberLimit: 500, requirement: 'vip', allowed: false },
  { memberLimit: 1_000, requirement: 'special_access', allowed: false },
] as const;

test('normaliza somente contagem numérica finita e não negativa', () => {
  assert.equal(normalizeCommunityMemberCount(8), 8);
  assert.equal(normalizeCommunityMemberCount(8.9), 8);
  assert.equal(normalizeCommunityMemberCount(0), 0);
  assert.equal(normalizeCommunityMemberCount(null), null);
  assert.equal(normalizeCommunityMemberCount(undefined), null);
  assert.equal(normalizeCommunityMemberCount('8'), null);
  assert.equal(normalizeCommunityMemberCount(-1), null);
  assert.equal(normalizeCommunityMemberCount(Number.NaN), null);
  assert.equal(normalizeCommunityMemberCount(Number.POSITIVE_INFINITY), null);
});

test('aplica incremento e decremento somente quando a base é confiável', () => {
  assert.equal(resolveCommunityMemberCountDelta(8, 1), 9);
  assert.equal(resolveCommunityMemberCountDelta(8, -1), 7);
  assert.equal(resolveCommunityMemberCountDelta(0, -1), 0);
  assert.equal(resolveCommunityMemberCountDelta(null, -1), null);
  assert.equal(resolveCommunityMemberCountDelta(undefined, 1), null);
  assert.equal(resolveCommunityMemberCountDelta('8', 1), null);
});

test('limita a capacidade conforme o plano ativo do proprietário', () => {
  assert.deepEqual(resolveCommunityMemberLimitOptions('free'), []);
  assert.deepEqual(resolveCommunityMemberLimitOptions('basic'), [25, 50, 100]);
  assert.deepEqual(
    resolveCommunityMemberLimitOptions('premium'),
    [25, 50, 100, 250]
  );
  assert.deepEqual(
    resolveCommunityMemberLimitOptions('vip'),
    [25, 50, 100, 250, 500]
  );
  assert.equal(isCommunityMemberLimitAllowed(250, 'basic'), false);
  assert.equal(isCommunityMemberLimitAllowed(250, 'premium'), true);
});

test('projeta requisitos e disponibilidade a partir da policy canônica', () => {
  assert.equal(resolveCommunityMemberLimitRequirement(25), 'basic');
  assert.equal(resolveCommunityMemberLimitRequirement(250), 'premium');
  assert.equal(resolveCommunityMemberLimitRequirement(500), 'vip');
  assert.equal(resolveCommunityMemberLimitRequirement(1_000), 'special_access');

  assert.deepEqual(
    resolveCommunityMemberLimitCapabilityOptions('free'),
    ALL_CAPACITY_OPTIONS
  );
  assert.deepEqual(
    resolveCommunityMemberLimitCapabilityOptions('premium'),
    ALL_CAPACITY_OPTIONS.map((option) => ({
      ...option,
      allowed: option.memberLimit <= 250,
    }))
  );
});

test('centraliza criação e quantidade de Comunidades pessoais por plano', () => {
  assert.deepEqual(resolvePersonalCommunityCreationPolicy('free'), {
    canCreate: false,
    maxOwnedCommunities: 0,
    memberLimit: 0,
  });
  assert.deepEqual(resolvePersonalCommunityCreationPolicy('basic'), {
    canCreate: true,
    maxOwnedCommunities: 1,
    memberLimit: 100,
  });
  assert.deepEqual(resolvePersonalCommunityCreationPolicy('premium'), {
    canCreate: true,
    maxOwnedCommunities: 3,
    memberLimit: 250,
  });
  assert.deepEqual(resolvePersonalCommunityCreationPolicy('vip'), {
    canCreate: true,
    maxOwnedCommunities: 5,
    memberLimit: 500,
  });
});

test('centraliza a recomendação de upgrade sem inferência no cliente', () => {
  assert.equal(resolveRecommendedCommunityUpgradeRole('free'), 'basic');
  assert.equal(resolveRecommendedCommunityUpgradeRole('basic'), 'premium');
  assert.equal(resolveRecommendedCommunityUpgradeRole('premium'), 'vip');
  assert.equal(resolveRecommendedCommunityUpgradeRole('vip'), null);
  assert.equal(resolveRecommendedCommunityUpgradeRole('admin'), null);
});

test('expõe capability autoritativa antes de montar o compositor', () => {
  assert.deepEqual(resolveCommunityCreationCapability({
    sponsorRole: 'free',
    currentOwnedCommunities: 0,
  }), {
    canCreate: false,
    reason: 'subscription_required',
    sponsorRole: 'free',
    minimumRole: 'basic',
    recommendedUpgradeRole: 'basic',
    currentOwnedCommunities: 0,
    maxOwnedCommunities: 0,
    memberLimit: 0,
    memberLimitOptions: ALL_CAPACITY_OPTIONS,
    allowedMemberLimits: [],
  });

  assert.deepEqual(resolveCommunityCreationCapability({
    sponsorRole: 'basic',
    currentOwnedCommunities: 0,
  }), {
    canCreate: true,
    reason: null,
    sponsorRole: 'basic',
    minimumRole: 'basic',
    recommendedUpgradeRole: null,
    currentOwnedCommunities: 0,
    maxOwnedCommunities: 1,
    memberLimit: 100,
    memberLimitOptions: ALL_CAPACITY_OPTIONS.map((option) => ({
      ...option,
      allowed: option.memberLimit <= 100,
    })),
    allowedMemberLimits: [25, 50, 100],
  });

  const premiumAtLimit = resolveCommunityCreationCapability({
    sponsorRole: 'premium',
    currentOwnedCommunities: 3,
  });
  assert.equal(premiumAtLimit.reason, 'limit_reached');
  assert.equal(premiumAtLimit.recommendedUpgradeRole, 'vip');
});

test('normaliza somente capacidades predefinidas', () => {
  assert.equal(normalizeCommunityMemberLimit(25), 25);
  assert.equal(normalizeCommunityMemberLimit(1_000), 1_000);
  assert.equal(normalizeCommunityMemberLimit(26), null);
  assert.equal(normalizeCommunityMemberLimit('100'), null);
});

test('downgrade pausa crescimento, sinaliza regularização e preserva membros', () => {
  const state = evaluateCommunityCapacity({
    rawCommunity: {
      capacity: { memberLimit: 1_000 },
      metrics: { memberCount: 430 },
    },
    sponsorRole: 'basic',
  });

  assert.deepEqual(state, {
    configuredLimit: 1_000,
    ownerPlanLimit: 100,
    effectiveLimit: 100,
    memberCount: 430,
    acceptingNewMembers: false,
    restrictedByOwnerPlan: true,
    regularizationRequired: true,
    regularizationReason: 'capacity_over_plan',
    atCapacity: true,
  });
});

test('assinatura inativa pausa novas entradas sem alterar membros existentes', () => {
  const state = evaluateCommunityCapacity({
    rawCommunity: {
      capacity: { memberLimit: 100 },
      metrics: { memberCount: 40 },
    },
    sponsorRole: 'free',
  });

  assert.equal(state.memberCount, 40);
  assert.equal(state.effectiveLimit, 0);
  assert.equal(state.acceptingNewMembers, false);
  assert.equal(state.regularizationRequired, true);
  assert.equal(state.regularizationReason, 'owner_subscription_required');
});

test('comunidade compatível com o plano não exige regularização', () => {
  const state = evaluateCommunityCapacity({
    rawCommunity: {
      capacity: { memberLimit: 100 },
      metrics: { memberCount: 40 },
    },
    sponsorRole: 'basic',
  });

  assert.equal(state.regularizationRequired, false);
  assert.equal(state.regularizationReason, null);
  assert.equal(state.acceptingNewMembers, true);
});

test('comunidade legada usa capacidade conservadora e falha fechada sem métrica', () => {
  const legacy = evaluateCommunityCapacity({
    rawCommunity: { metrics: { memberCount: 24 } },
    sponsorRole: 'vip',
  });
  const inconsistent = evaluateCommunityCapacity({
    rawCommunity: { capacity: { memberLimit: 100 }, metrics: {} },
    sponsorRole: 'premium',
  });

  assert.equal(legacy.configuredLimit, 25);
  assert.equal(legacy.acceptingNewMembers, true);
  assert.equal(inconsistent.acceptingNewMembers, false);
});

test('Espaço Oficial usa o teto comercial centralizado de mil participantes', () => {
  const state = evaluateCommunityCapacity({
    rawCommunity: {
      source: { type: 'venue' },
      metrics: { memberCount: 999 },
    },
    sponsorRole: 'official_space',
  });

  assert.equal(state.configuredLimit, 1_000);
  assert.equal(state.effectiveLimit, 1_000);
  assert.equal(state.acceptingNewMembers, true);
  assert.equal(state.regularizationRequired, false);

  const serviceState = evaluateCommunityCapacityForOwner({
    rawCommunity: {
      source: { type: 'venue' },
      metrics: { memberCount: 999 },
    },
    rawOwnerUser: null,
    rawOwnerEntitlement: null,
  });
  assert.equal(serviceState?.effectiveLimit, 1_000);
});

test('admin preserva teto operacional e assinatura inválida volta para free', () => {
  assert.equal(resolveCommunityCapacitySponsorRole('vip', 'admin'), 'admin');
  assert.equal(resolveCommunityCapacitySponsorRole('premium', 'free'), 'premium');
  assert.equal(resolveCommunityCapacitySponsorRole('gold', 'free'), 'free');
});

test('deriva capacidade do entitlement canônico do proprietário', () => {
  const now = 1_800_000_000_000;
  const community = {
    ownerUid: 'owner-1',
    capacity: { memberLimit: 250 },
    metrics: { memberCount: 100 },
  };
  const premium = evaluateCommunityCapacityForOwner({
    rawCommunity: community,
    rawOwnerUser: { role: 'premium' },
    rawOwnerEntitlement: {
      active: true,
      buyerUid: 'owner-1',
      scope: 'platform_subscription',
      planKey: 'premium',
      grantedRole: 'premium',
      startsAt: now - 1_000,
      endsAt: now + 1_000,
    },
    now,
  });
  const expired = evaluateCommunityCapacityForOwner({
    rawCommunity: community,
    rawOwnerUser: { role: 'free' },
    rawOwnerEntitlement: {
      active: true,
      buyerUid: 'owner-1',
      scope: 'platform_subscription',
      planKey: 'premium',
      grantedRole: 'premium',
      startsAt: now - 2_000,
      endsAt: now - 1,
    },
    now,
  });

  assert.equal(premium?.effectiveLimit, 250);
  assert.equal(premium?.acceptingNewMembers, true);
  assert.equal(premium?.regularizationRequired, false);
  assert.equal(expired?.effectiveLimit, 0);
  assert.equal(expired?.acceptingNewMembers, false);
  assert.equal(expired?.regularizationReason, 'owner_subscription_required');
});

test('libera Espaço Oficial somente para organização verificada e vigente', () => {
  const decision = evaluateOfficialSpaceCreationGrant({
    actorUid: 'owner-1',
    actorUserRole: 'free',
    rawGrant: {
      holderUid: 'owner-1',
      organizationId: 'organization-1',
      scope: 'official_space_creation',
      active: true,
      verificationStatus: 'verified',
      startsAt: OFFICIAL_SPACE_NOW - 1_000,
      endsAt: OFFICIAL_SPACE_NOW + 1_000,
      maxOfficialSpaces: 2,
      policyVersion: 1,
    },
    now: OFFICIAL_SPACE_NOW,
  });

  assert.deepEqual(decision, {
    allowed: true,
    organizationId: 'organization-1',
    maxOfficialSpaces: 2,
    memberLimit: 1_000,
    denialReason: null,
  });
});

test('plano pessoal nunca substitui a verificação comercial', () => {
  const decision = evaluateOfficialSpaceCreationGrant({
    actorUid: 'owner-1',
    actorUserRole: 'vip',
    rawGrant: null,
    now: OFFICIAL_SPACE_NOW,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.denialReason, 'verification_required');
});

test('concessão comercial vencida pausa somente novos cadastros', () => {
  const decision = evaluateOfficialSpaceCreationGrant({
    actorUid: 'owner-1',
    actorUserRole: 'free',
    rawGrant: {
      holderUid: 'owner-1',
      organizationId: 'organization-1',
      scope: 'official_space_creation',
      active: true,
      verificationStatus: 'verified',
      startsAt: OFFICIAL_SPACE_NOW - 2_000,
      endsAt: OFFICIAL_SPACE_NOW - 1,
      maxOfficialSpaces: 1,
      policyVersion: 1,
    },
    now: OFFICIAL_SPACE_NOW,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.denialReason, 'grant_inactive');
});

test('admin mantém exceção operacional sem usar assinatura pessoal', () => {
  const decision = evaluateOfficialSpaceCreationGrant({
    actorUid: 'admin-1',
    actorUserRole: 'admin',
    rawGrant: null,
    now: OFFICIAL_SPACE_NOW,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.maxOfficialSpaces, null);
  assert.equal(decision.memberLimit, 1_000);
});
