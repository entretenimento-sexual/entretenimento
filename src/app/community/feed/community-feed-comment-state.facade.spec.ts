import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CommunityFeedCommentStateFacade } from './community-feed-comment-state.facade';

function item(input: {
  postId?: string;
  canViewComments?: boolean;
  canComment?: boolean;
  commentCount?: number;
} = {}) {
  return {
    postId: input.postId ?? 'post-1',
    capabilities: {
      canViewComments: input.canViewComments ?? true,
      canComment: input.canComment ?? true,
    },
    metrics: {
      commentCount: input.commentCount ?? 3,
    },
  } as never;
}

function realtime(input: {
  postId?: string;
  commentCount?: number;
  type?: 'added' | 'modified' | 'removed';
  state?: 'active' | 'removed';
} = {}) {
  return {
    type: input.type ?? 'modified',
    projection: {
      postId: input.postId ?? 'post-1',
      state: input.state ?? 'active',
      metrics: {
        commentCount: input.commentCount ?? 4,
      },
    },
  } as never;
}

describe('CommunityFeedCommentStateFacade', () => {
  it('mantém abertura para leitura separada da intenção de responder', () => {
    const facade = new CommunityFeedCommentStateFacade();
    const target = item();

    facade.toggle(target);
    assert.equal(facade.commentsPostId(), 'post-1');
    assert.equal(facade.replyPostId(), null);

    facade.openForReply(target);
    assert.equal(facade.commentsPostId(), 'post-1');
    assert.equal(facade.replyPostId(), 'post-1');
    assert.equal(facade.postReplyRequestVersion(), 1);

    facade.clearReplyContext(target);
    assert.equal(facade.replyPostId(), null);
  });

  it('respeita capabilities antes de abrir comentários ou resposta', () => {
    const facade = new CommunityFeedCommentStateFacade();

    facade.toggle(item({ canViewComments: false }));
    facade.openForReply(item({ canComment: false }));

    assert.equal(facade.commentsPostId(), null);
    assert.equal(facade.replyPostId(), null);
    assert.equal(facade.postReplyRequestVersion(), 0);
  });

  it('mantém override local e o reconcilia com realtime canônico', () => {
    const facade = new CommunityFeedCommentStateFacade();
    const target = item({ commentCount: 3 });

    assert.equal(facade.commentCount(target), 3);

    facade.updateCommentCount(target, 7.9);
    assert.equal(facade.commentCount(target), 7);

    facade.reconcileRealtime([
      realtime({ commentCount: 9 }),
    ]);
    assert.equal(facade.commentCount(target), 9);

    facade.reconcileRealtime([
      realtime({ type: 'removed', state: 'removed' }),
    ]);
    assert.equal(facade.commentCount(target), 3);
  });

  it('limpa estado associado ao post removido', () => {
    const facade = new CommunityFeedCommentStateFacade();
    const target = item();

    facade.openForReply(target);
    facade.updateCommentCount(target, 8);
    facade.clearItem('post-1');

    assert.equal(facade.commentsPostId(), null);
    assert.equal(facade.replyPostId(), null);
    assert.equal(facade.commentCount(target), 3);
  });
});
