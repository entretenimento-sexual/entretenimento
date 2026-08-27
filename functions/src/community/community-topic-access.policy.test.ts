import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canViewerCreateCommunityTopic,
  canViewerModerateCommunityTopic,
  canViewerReadCommunityTopicAudience,
  canViewerReadCommunityTopicProjection,
  canViewerReplyToCommunityTopic,
  resolveCommunityTopicContentAccess,
} from './community-topic-access.policy';
import type { SanitizedCommunityTopicProjection } from './community-topic.model';

const PUBLIC_TOPIC: SanitizedCommunityTopicProjection = {
  audience: 'public_preview',
  item: {
    topicId: 'topic-public',
    title: 'Tópico público',
    excerpt: 'Resumo',
    author: { label: 'Pessoa', avatarUrl: null },
    status: 'active',
    metrics: { replyCount: 0, reactionCount: 0 },
    createdAt: 1_000,
    lastActivityAt: 1_000,
  },
};

const MEMBER_TOPIC: SanitizedCommunityTopicProjection = {
  ...PUBLIC_TOPIC,
  audience: 'members_only',
  item: {
    ...PUBLIC_TOPIC.item,
    topicId: 'topic-members',
  },
};

test('prévia autenticada concede leitura dos Tópicos sem conceder membership', () => {
  const topicContentAccess = resolveCommunityTopicContentAccess(false, true);

  assert.equal(topicContentAccess, true);
  assert.equal(
    canViewerReadCommunityTopicProjection(MEMBER_TOPIC, topicContentAccess),
    true
  );
});

test('Comunidade reservada continua exigindo membership para Tópicos restritos', () => {
  assert.equal(resolveCommunityTopicContentAccess(false, false), false);
  assert.equal(resolveCommunityTopicContentAccess(true, false), true);
  assert.equal(canViewerReadCommunityTopicAudience('members_only', false), false);
  assert.equal(canViewerReadCommunityTopicProjection(MEMBER_TOPIC, false), false);
  assert.equal(canViewerReadCommunityTopicProjection(MEMBER_TOPIC, true), true);
});

test('permite leitura de tópico public_preview sem acesso ampliado', () => {
  assert.equal(canViewerReadCommunityTopicAudience('public_preview', false), true);
  assert.equal(canViewerReadCommunityTopicProjection(PUBLIC_TOPIC, false), true);
});

test('criação depende exclusivamente do canInteract autoritativo', () => {
  assert.equal(canViewerCreateCommunityTopic(false), false);
  assert.equal(canViewerCreateCommunityTopic(true), true);
});

test('resposta exige canInteract e tópico ativo', () => {
  assert.equal(canViewerReplyToCommunityTopic('active', true), true);
  assert.equal(canViewerReplyToCommunityTopic('active', false), false);
  assert.equal(canViewerReplyToCommunityTopic('locked', true), false);
  assert.equal(canViewerReplyToCommunityTopic('archived', true), false);
});

test('somente owner, admin e moderator podem moderar tópico', () => {
  assert.equal(canViewerModerateCommunityTopic('owner'), true);
  assert.equal(canViewerModerateCommunityTopic('admin'), true);
  assert.equal(canViewerModerateCommunityTopic('moderator'), true);
  assert.equal(canViewerModerateCommunityTopic('member'), false);
  assert.equal(canViewerModerateCommunityTopic(null), false);
});
