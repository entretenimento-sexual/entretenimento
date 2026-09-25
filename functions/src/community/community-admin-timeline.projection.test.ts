import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCommunityAdminTimelineProjection,
  buildCommunityAdminTimelineProjectionId,
} from './community-admin-timeline.projection';

test('projeta mudança de papel sem carregar payload bruto', () => {
  const result = buildCommunityAdminTimelineProjection({
    source: 'membership',
    auditId: 'audit-1',
    rawAudit: {
      action: 'community-member-role-changed',
      communityId: 'community-1',
      actorUid: 'owner-1',
      subjectUid: 'member-1',
      previousRole: 'member',
      role: 'moderator',
      createdAt: 1_000,
      reason: 'nao-deve-vazar',
    },
  });

  assert.deepEqual(result, {
    version: 1,
    source: 'membership',
    sourceAuditId: 'audit-1',
    communityId: 'community-1',
    category: 'membership',
    eventType: 'member_role_changed',
    actorKind: 'user',
    actorUid: 'owner-1',
    subjectUid: 'member-1',
    details: {
      previousRole: 'member',
      nextRole: 'moderator',
    },
    createdAtMs: 1_000,
  });
  assert.equal(Object.hasOwn(result ?? {}, 'reason'), false);
});

test('ignora exclusão autoral e projeta apenas moderação da gestão', () => {
  const authorDelete = buildCommunityAdminTimelineProjection({
    source: 'feed',
    auditId: 'author-delete',
    rawAudit: {
      action: 'community-feed-post-deleted-by-author',
      communityId: 'community-1',
      actorUid: 'member-1',
      createdAt: 2_000,
    },
  });

  const managementRemove = buildCommunityAdminTimelineProjection({
    source: 'feed',
    auditId: 'management-remove',
    rawAudit: {
      action: 'community-feed-comment-removed-by-management',
      communityId: 'community-1',
      actorUid: 'moderator-1',
      commentId: 'private-comment-id',
      reason: 'private-reason',
      createdAt: 2_100,
    },
  });

  assert.equal(authorDelete, null);
  assert.deepEqual(managementRemove?.details, { target: 'comment' });
});

test('limita campos de configuração ao catálogo seguro', () => {
  const result = buildCommunityAdminTimelineProjection({
    source: 'settings',
    auditId: 'settings-1',
    rawAudit: {
      action: 'community_settings_updated',
      communityId: 'community-1',
      actorUid: 'admin-1',
      changedFields: ['name', 'memberLimit', 'internalSecret', 'name'],
      createdAt: 3_000,
    },
  });

  assert.deepEqual(result?.details.changedFields, ['name', 'memberLimit']);
});

test('vínculo oficial não expõe revisor, resolução ou evidência', () => {
  const result = buildCommunityAdminTimelineProjection({
    source: 'official',
    auditId: 'official-1',
    rawAudit: {
      action: 'official_claim_approve',
      communityId: 'community-1',
      actorUid: 'platform-admin',
      previousStatus: 'under_review',
      nextStatus: 'verified',
      resolution: 'conteudo privado',
      verifiedEvidenceType: 'document',
      createdAt: 4_000,
    },
  });

  assert.equal(result?.actorKind, 'system');
  assert.equal(result?.actorUid, null);
  assert.deepEqual(result?.details, {
    previousStatus: 'under_review',
    nextStatus: 'verified',
  });
});

test('gera id determinístico sem expor o audit id', () => {
  const first = buildCommunityAdminTimelineProjectionId(
    'membership',
    'audit-1'
  );
  const second = buildCommunityAdminTimelineProjectionId(
    'membership',
    'audit-1'
  );

  assert.equal(first, second);
  assert.equal(first.includes('audit-1'), false);
});

test('projeta revogação da associação oficial sem reason ou target bruto', () => {
  const result = buildCommunityAdminTimelineProjection({
    source: 'official_association',
    auditId: 'association-1',
    rawAudit: {
      action: 'official_association_revoked',
      communityId: 'community-1',
      associationKey: 'private-association-key',
      target: { type: 'venue', id: 'private-target' },
      previousStatus: 'verified',
      nextStatus: 'revoked',
      reason: 'community_terminal',
      createdAt: 5_000,
    },
  });

  assert.equal(result?.actorKind, 'system');
  assert.equal(result?.actorUid, null);
  assert.deepEqual(result?.details, {
    previousStatus: 'verified',
    nextStatus: 'revoked',
  });
  assert.equal(Object.hasOwn(result ?? {}, 'reason'), false);
});


test('projeta alteração da política de visibilidade como configuração segura', () => {
  const result = buildCommunityAdminTimelineProjection({
    source: 'settings',
    auditId: 'settings-disclosure-1',
    rawAudit: {
      action: 'community_membership_disclosure_updated',
      communityId: 'community-1',
      actorUid: 'owner-1',
      previousMode: 'hidden',
      nextMode: 'visible',
      previousPolicyVersion: 1,
      nextPolicyVersion: 2,
      createdAt: 6_000,
    },
  });

  assert.deepEqual(result?.details, {
    changedFields: ['membershipDisclosure'],
  });
});

test('projeta destaque administrativo sem expor targetId ou duração', () => {
  const result = buildCommunityAdminTimelineProjection({
    source: 'highlight',
    auditId: 'highlight-1',
    rawAudit: {
      action: 'community-highlight-pinned',
      communityId: 'community-1',
      actorUid: 'admin-1',
      actorRole: 'admin',
      targetType: 'feed_post',
      targetId: 'private-post-id',
      duration: '24h',
      changed: true,
      createdAt: 7_000,
    },
  });

  assert.equal(result?.eventType, 'highlight_changed');
  assert.deepEqual(result?.details, {
    target: 'post',
    action: 'pinned',
  });
  assert.equal(Object.hasOwn(result ?? {}, 'targetId'), false);
});
