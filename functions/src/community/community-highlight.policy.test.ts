import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateCommunityHighlightAction,
  shouldClearCommunityHighlightForCommunityTransition,
  shouldClearCommunityHighlightForPostTransition,
} from './community-highlight.policy';

for (const viewerRole of ['owner', 'admin', 'moderator'] as const) {
  test(`permite ${viewerRole} ativo fixar publicação ativa`, () => {
    assert.deepEqual(evaluateCommunityHighlightAction({
      action: 'pin',
      sourceType: 'community',
      communityOperational: true,
      membershipStatus: 'active',
      viewerRole,
      targetPostStatus: 'active',
      targetPostModerationState: 'active',
    }), { allowed: true, denialReason: null });
  });
}

test('impede membro comum de administrar destaque', () => {
  assert.deepEqual(evaluateCommunityHighlightAction({
    action: 'pin',
    sourceType: 'community',
    communityOperational: true,
    membershipStatus: 'active',
    viewerRole: 'member',
    targetPostStatus: 'active',
    targetPostModerationState: 'active',
  }), {
    allowed: false,
    denialReason: 'active_management_required',
  });
});

test('exige vínculo ativo mesmo para papel administrativo', () => {
  assert.deepEqual(evaluateCommunityHighlightAction({
    action: 'unpin',
    sourceType: 'community',
    communityOperational: true,
    membershipStatus: 'left',
    viewerRole: 'admin',
  }), {
    allowed: false,
    denialReason: 'active_management_required',
  });
});

test('não altera destaque quando a Comunidade não está operacional', () => {
  assert.deepEqual(evaluateCommunityHighlightAction({
    action: 'unpin',
    sourceType: 'community',
    communityOperational: false,
    membershipStatus: 'active',
    viewerRole: 'owner',
  }), {
    allowed: false,
    denialReason: 'community_unavailable',
  });
});

test('não aplica destaque editorial a outro tipo de espaço', () => {
  assert.deepEqual(evaluateCommunityHighlightAction({
    action: 'unpin',
    sourceType: 'venue',
    communityOperational: true,
    membershipStatus: 'active',
    viewerRole: 'owner',
  }), {
    allowed: false,
    denialReason: 'community_source_not_supported',
  });
});

test('não permite fixar publicação removida ou indisponível', () => {
  assert.deepEqual(evaluateCommunityHighlightAction({
    action: 'pin',
    sourceType: 'community',
    communityOperational: true,
    membershipStatus: 'active',
    viewerRole: 'moderator',
    targetPostStatus: 'removed',
    targetPostModerationState: 'removed',
  }), {
    allowed: false,
    denialReason: 'post_unavailable',
  });
});

test('desafixar não depende do estado do alvo antigo', () => {
  assert.deepEqual(evaluateCommunityHighlightAction({
    action: 'unpin',
    sourceType: 'community',
    communityOperational: true,
    membershipStatus: 'active',
    viewerRole: 'moderator',
    targetPostStatus: 'removed',
    targetPostModerationState: 'removed',
  }), { allowed: true, denialReason: null });
});

test('limpa destaque quando a publicação-alvo deixa de estar ativa', () => {
  assert.equal(shouldClearCommunityHighlightForPostTransition({
    highlightedTargetType: 'feed_post',
    highlightedTargetId: 'post-1',
    postId: 'post-1',
    afterExists: true,
    afterStatus: 'removed',
    afterModerationState: 'removed',
  }), true);
});

test('limpa destaque quando a publicação-alvo é excluída', () => {
  assert.equal(shouldClearCommunityHighlightForPostTransition({
    highlightedTargetType: 'feed_post',
    highlightedTargetId: 'post-1',
    postId: 'post-1',
    afterExists: false,
    afterStatus: null,
    afterModerationState: null,
  }), true);
});

test('não interfere em outro destaque nem em atualização ainda ativa', () => {
  assert.equal(shouldClearCommunityHighlightForPostTransition({
    highlightedTargetType: 'feed_post',
    highlightedTargetId: 'post-2',
    postId: 'post-1',
    afterExists: false,
    afterStatus: null,
    afterModerationState: null,
  }), false);

  assert.equal(shouldClearCommunityHighlightForPostTransition({
    highlightedTargetType: 'feed_post',
    highlightedTargetId: 'post-1',
    postId: 'post-1',
    afterExists: true,
    afterStatus: 'active',
    afterModerationState: 'active',
  }), false);
});

test('limpa destaque ao pausar, moderar ou excluir a Comunidade', () => {
  assert.equal(shouldClearCommunityHighlightForCommunityTransition({
    afterExists: true,
    afterStatus: 'paused',
    afterModerationState: 'active',
  }), true);
  assert.equal(shouldClearCommunityHighlightForCommunityTransition({
    afterExists: true,
    afterStatus: 'active',
    afterModerationState: 'suspended',
  }), true);
  assert.equal(shouldClearCommunityHighlightForCommunityTransition({
    afterExists: false,
    afterStatus: null,
    afterModerationState: null,
  }), true);
  assert.equal(shouldClearCommunityHighlightForCommunityTransition({
    afterExists: true,
    afterStatus: 'active',
    afterModerationState: 'active',
  }), false);
});
