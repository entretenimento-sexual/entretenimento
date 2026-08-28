import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateCommunityFeedCommentAction,
  evaluateCommunityFeedCommentWrite,
  isCommunityFeedInteractivePostKind,
} from './community-feed-comment.policy';

test('membro ativo comenta mensagem textual ativa', () => {
  assert.deepEqual(evaluateCommunityFeedCommentWrite({
    sourceType: 'community',
    memberActivityAllowed: true,
    membershipStatus: 'active',
    viewerRole: 'member',
    postKind: 'text',
    postStatus: 'active',
    postModerationState: 'active',
  }), { allowed: true, denialReason: null });
});

test('membro ativo comenta foto da mesma timeline', () => {
  assert.equal(isCommunityFeedInteractivePostKind('text'), true);
  assert.equal(isCommunityFeedInteractivePostKind('photo'), true);
  assert.equal(isCommunityFeedInteractivePostKind('video'), false);
  assert.deepEqual(evaluateCommunityFeedCommentWrite({
    sourceType: 'community',
    memberActivityAllowed: true,
    membershipStatus: 'active',
    viewerRole: 'member',
    postKind: 'photo',
    postStatus: 'active',
    postModerationState: 'active',
  }), { allowed: true, denialReason: null });
});

test('nega visitante, Local, lifecycle fechado, tipo desconhecido e mensagem removida', () => {
  const base = {
    sourceType: 'community',
    memberActivityAllowed: true,
    membershipStatus: 'active',
    viewerRole: 'member' as const,
    postKind: 'text',
    postStatus: 'active',
    postModerationState: 'active',
  };
  assert.equal(evaluateCommunityFeedCommentWrite({
    ...base,
    membershipStatus: null,
    viewerRole: null,
  }).denialReason, 'active_membership_required');
  assert.equal(evaluateCommunityFeedCommentWrite({
    ...base,
    sourceType: 'venue',
  }).denialReason, 'community_unavailable');
  assert.equal(evaluateCommunityFeedCommentWrite({
    ...base,
    memberActivityAllowed: false,
  }).denialReason, 'community_unavailable');
  assert.equal(evaluateCommunityFeedCommentWrite({
    ...base,
    postStatus: 'removed',
  }).denialReason, 'post_unavailable');
  assert.equal(evaluateCommunityFeedCommentWrite({
    ...base,
    postKind: 'video',
  }).denialReason, 'post_unavailable');
});

test('autor exclui e gestão remove comentário com motivo', () => {
  const base = {
    sourceType: 'community',
    memberActivityAllowed: true,
    actorUid: 'author-1',
    authorUid: 'author-1',
    membershipStatus: 'active',
    viewerRole: 'member' as const,
    currentStatus: 'active' as const,
    currentModerationState: 'active' as const,
    reason: null,
  };
  assert.equal(evaluateCommunityFeedCommentAction({
    ...base,
    action: 'delete_own',
  }).allowed, true);
  assert.equal(evaluateCommunityFeedCommentAction({
    ...base,
    action: 'remove',
    actorUid: 'moderator-1',
    viewerRole: 'moderator',
    reason: 'Fora das regras.',
  }).nextStatus, 'removed');
});

test('outro membro não exclui e remoção exige gestão ativa e motivo', () => {
  const base = {
    action: 'delete_own' as const,
    sourceType: 'community',
    memberActivityAllowed: true,
    actorUid: 'member-2',
    authorUid: 'author-1',
    membershipStatus: 'active',
    viewerRole: 'member' as const,
    currentStatus: 'active' as const,
    currentModerationState: 'active' as const,
    reason: null,
  };
  assert.equal(evaluateCommunityFeedCommentAction(base).denialReason,
    'comment_author_required');
  assert.equal(evaluateCommunityFeedCommentAction({
    ...base,
    action: 'remove',
  }).denialReason, 'active_management_required');
  assert.equal(evaluateCommunityFeedCommentAction({
    ...base,
    action: 'remove',
    viewerRole: 'moderator',
  }).denialReason, 'removal_reason_required');
});
