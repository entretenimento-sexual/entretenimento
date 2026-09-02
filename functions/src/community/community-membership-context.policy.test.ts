// functions/src/community/community-membership-context.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_MEMBERSHIP_CONTEXT_MAX_IDS,
  isCommunityMembershipContextActive,
  normalizeCommunityMembershipContextIds,
} from './community-membership-context.policy';

test('normaliza IDs visíveis sem enumerar além do limite', () => {
  assert.deepEqual(
    normalizeCommunityMembershipContextIds([
      'community-1',
      'community-2',
      'community-1',
    ]),
    ['community-1', 'community-2']
  );

  assert.equal(normalizeCommunityMembershipContextIds([]), null);
  assert.equal(
    normalizeCommunityMembershipContextIds(
      Array.from(
        { length: COMMUNITY_MEMBERSHIP_CONTEXT_MAX_IDS + 1 },
        (_, index) => `community-${index}`
      )
    ),
    null
  );
});

test('rejeita qualquer ID inválido em vez de omiti-lo silenciosamente', () => {
  assert.equal(
    normalizeCommunityMembershipContextIds([
      'community-ok',
      '../community-invalid',
    ]),
    null
  );
});

test('considera ativo somente membership explicitamente ativa', () => {
  assert.equal(isCommunityMembershipContextActive({ status: 'active' }), true);
  assert.equal(isCommunityMembershipContextActive({ status: 'pending' }), false);
  assert.equal(isCommunityMembershipContextActive({ status: 'blocked' }), false);
  assert.equal(isCommunityMembershipContextActive({ status: 'left' }), false);
  assert.equal(isCommunityMembershipContextActive(null), false);
});
