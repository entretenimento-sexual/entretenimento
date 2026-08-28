// functions/src/community/community-purge.firestore.policy.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMMUNITY_PURGE_FINAL_ROOT_COLLECTIONS,
  COMMUNITY_PURGE_MEMBER_SCOPED_COLLECTIONS,
  COMMUNITY_PURGE_PROJECTION_ROOT_COLLECTIONS,
  COMMUNITY_PURGE_PROTECTED_COLLECTIONS,
  COMMUNITY_PURGE_REFERENCE_COLLECTIONS,
  assertCommunityPurgeMembershipsTerminal,
  isCommunityPurgeProtectedCollection,
} from './community-purge.firestore.policy';

test('mapeia somente referências operacionais explicitamente autorizadas', () => {
  assert.deepEqual(Object.keys(COMMUNITY_PURGE_REFERENCE_COLLECTIONS), [
    'creation_requests',
    'feed_requests',
    'topic_requests',
    'lifecycle_requests',
    'invites',
    'notifications',
  ]);
});

test('mantém resíduos privados limitados aos namespaces conhecidos por membership', () => {
  assert.deepEqual(COMMUNITY_PURGE_MEMBER_SCOPED_COLLECTIONS, [
    'community_feed_user_actions',
    'community_feed_user_reactions',
    'community_feed_user_comments',
    'community_feed_user_replies',
  ]);
});

test('separa projeções transitórias das raízes canônicas finais', () => {
  assert.deepEqual(COMMUNITY_PURGE_PROJECTION_ROOT_COLLECTIONS, [
    'community_discovery_index',
    'community_public_feed',
    'community_public_topics',
    'community_feed_realtime',
  ]);
  assert.deepEqual(COMMUNITY_PURGE_FINAL_ROOT_COLLECTIONS, [
    'community_feed_posts',
    'community_topics',
    'communities',
  ]);
});

test('nenhum namespace de retenção aparece entre os alvos de purge', () => {
  const purgeTargets = new Set<string>([
    ...Object.values(COMMUNITY_PURGE_REFERENCE_COLLECTIONS),
    ...COMMUNITY_PURGE_MEMBER_SCOPED_COLLECTIONS,
    ...COMMUNITY_PURGE_PROJECTION_ROOT_COLLECTIONS,
    ...COMMUNITY_PURGE_FINAL_ROOT_COLLECTIONS,
    'community_user_index',
  ]);

  for (const protectedCollection of COMMUNITY_PURGE_PROTECTED_COLLECTIONS) {
    assert.equal(purgeTargets.has(protectedCollection), false);
    assert.equal(isCommunityPurgeProtectedCollection(protectedCollection), true);
  }
});

test('memberships históricas left são elegíveis à limpeza de referência', () => {
  assert.doesNotThrow(() =>
    assertCommunityPurgeMembershipsTerminal([
      { status: 'left' },
      { status: 'left', role: 'member' },
    ])
  );
});

test('membership ativa, pendente, bloqueada ou desconhecida falha fechado', () => {
  for (const status of ['active', 'pending', 'blocked', 'unknown', null]) {
    assert.throws(
      () => assertCommunityPurgeMembershipsTerminal([{ status }]),
      (error: unknown) => {
        const source = error as { code?: unknown };
        return source.code === 'community-purge-membership-not-terminal';
      }
    );
  }
});
