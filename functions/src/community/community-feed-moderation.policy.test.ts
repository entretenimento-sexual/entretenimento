import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateCommunityFeedPostAction } from './community-feed-moderation.policy';

const base = {
  action: 'delete_own' as const,
  sourceType: 'community',
  actorUid: 'author-1',
  authorUid: 'author-1',
  membershipStatus: 'left',
  viewerRole: null,
  currentStatus: 'active' as const,
  currentModerationState: 'active' as const,
  reason: null,
};

test('autor pode excluir a própria publicação mesmo após sair', () => {
  assert.deepEqual(evaluateCommunityFeedPostAction(base), {
    allowed: true,
    denialReason: null,
    idempotent: false,
    nextStatus: 'deleted',
    nextModerationState: 'active',
  });
});

test('outro membro não pode excluir como se fosse autor', () => {
  assert.equal(evaluateCommunityFeedPostAction({
    ...base,
    actorUid: 'member-2',
  }).denialReason, 'post_author_required');
});

test('gestão ativa remove com motivo e membro comum não remove', () => {
  assert.equal(evaluateCommunityFeedPostAction({
    ...base,
    action: 'remove',
    actorUid: 'moderator-1',
    membershipStatus: 'active',
    viewerRole: 'moderator',
    reason: 'Viola as regras da Comunidade.',
  }).allowed, true);

  assert.equal(evaluateCommunityFeedPostAction({
    ...base,
    action: 'remove',
    actorUid: 'member-2',
    authorUid: 'author-1',
    membershipStatus: 'active',
    viewerRole: 'member',
    reason: 'Viola as regras da Comunidade.',
  }).denialReason, 'active_management_required');
});

test('remoção exige motivo e transição repetida é idempotente', () => {
  assert.equal(evaluateCommunityFeedPostAction({
    ...base,
    action: 'remove',
    actorUid: 'owner-1',
    membershipStatus: 'active',
    viewerRole: 'owner',
    reason: '  ',
  }).denialReason, 'removal_reason_required');

  assert.equal(evaluateCommunityFeedPostAction({
    ...base,
    currentStatus: 'deleted',
  }).idempotent, true);
});

test('Local e publicação já removida não aceitam ação incompatível', () => {
  assert.equal(evaluateCommunityFeedPostAction({
    ...base,
    sourceType: 'venue',
  }).denialReason, 'post_unavailable');
  assert.equal(evaluateCommunityFeedPostAction({
    ...base,
    currentStatus: 'removed',
    currentModerationState: 'removed',
  }).denialReason, 'post_unavailable');
});
