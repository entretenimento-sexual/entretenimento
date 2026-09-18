// functions/src/community/community-invalid-join-policy.contract.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateCommunityMembershipRequest,
} from './community-membership-request.policy';
import {
  sanitizeCommunityDiscoveryProjection,
  sanitizeCommunityDocument,
} from './community-preview.model';

function projection(join: unknown) {
  return {
    name: 'Comunidade do Centro',
    slug: 'comunidade-do-centro',
    description: 'Grupo permanente de pessoas da região central.',
    source: { type: 'community', id: 'community-1' },
    status: 'active',
    moderationState: 'active',
    moderation: { state: 'active' },
    visibility: 'public_preview',
    tagIds: ['intent:friendship'],
    metrics: { memberCount: 10, postCount: 4, mediaCount: 3 },
    access: {
      preview: 'authenticated',
      interaction: 'members_only',
      join,
    },
  };
}

test('admissão falha fechado quando access.join não é canônico', () => {
  const decision = evaluateCommunityMembershipRequest({
    operational: true,
    publicPreview: true,
    join: null,
    existingStatus: null,
    actorEligible: true,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.targetStatus, null);
  assert.equal(decision.denialReason, 'join_policy_invalid');
  assert.equal(decision.incrementMemberCount, false);
});

test('preview e descoberta não inventam approval para access.join inválido', () => {
  for (const join of [undefined, null, 'unknown', 123]) {
    const raw = projection(join);

    assert.equal(
      sanitizeCommunityDiscoveryProjection('community-1', raw),
      null
    );
    assert.equal(
      sanitizeCommunityDocument('community-1', raw),
      null
    );
  }
});
