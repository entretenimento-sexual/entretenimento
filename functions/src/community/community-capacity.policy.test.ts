// functions/src/community/community-capacity.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveCommunityCreationCapability,
  resolveCommunityMemberLimitRequirement,
  resolveRecommendedCommunityUpgradeRole,
} from './community-capacity.policy';
import { COMMUNITY_PRODUCT_LIMITS } from './community-product-limits.config';

test('mantém a estratégia comercial canônica internamente coerente', () => {
  const roleOrder = COMMUNITY_PRODUCT_LIMITS.publicSubscriptionRoleOrder;
  const minimumRole =
    COMMUNITY_PRODUCT_LIMITS.minimumPersonalCommunityCreationRole;

  assert.ok(roleOrder.length > 0);
  assert.ok(roleOrder.includes(minimumRole));

  for (const role of roleOrder) {
    assert.ok(role in COMMUNITY_PRODUCT_LIMITS.memberLimitBySponsorRole);
    assert.ok(
      role in COMMUNITY_PRODUCT_LIMITS.ownedPersonalCommunitiesBySponsorRole
    );
  }
});

test('deriva o upgrade recomendado da estratégia comercial canônica', () => {
  const roleOrder = COMMUNITY_PRODUCT_LIMITS.publicSubscriptionRoleOrder;

  assert.equal(
    resolveRecommendedCommunityUpgradeRole('free'),
    COMMUNITY_PRODUCT_LIMITS.minimumPersonalCommunityCreationRole
  );

  roleOrder.forEach((role, index) => {
    assert.equal(
      resolveRecommendedCommunityUpgradeRole(role),
      roleOrder[index + 1] ?? null
    );
  });

  assert.equal(resolveRecommendedCommunityUpgradeRole('admin'), null);
});

test('expõe a role mínima de criação a partir da configuração canônica', () => {
  const sponsorRoles = [
    'free',
    ...COMMUNITY_PRODUCT_LIMITS.publicSubscriptionRoleOrder,
    'admin',
  ] as const;

  for (const sponsorRole of sponsorRoles) {
    const capability = resolveCommunityCreationCapability({
      sponsorRole,
      currentOwnedCommunities: 0,
    });

    assert.equal(
      capability.minimumRole,
      COMMUNITY_PRODUCT_LIMITS.minimumPersonalCommunityCreationRole
    );
  }
});

test('deriva o requisito de capacidade da ordem comercial canônica', () => {
  for (const memberLimit of COMMUNITY_PRODUCT_LIMITS.selectableMemberLimits) {
    const expectedRequirement =
      COMMUNITY_PRODUCT_LIMITS.publicSubscriptionRoleOrder.find(
        (role) =>
          memberLimit
          <= COMMUNITY_PRODUCT_LIMITS.memberLimitBySponsorRole[role]
      ) ?? 'special_access';

    assert.equal(
      resolveCommunityMemberLimitRequirement(memberLimit),
      expectedRequirement
    );
  }
});
