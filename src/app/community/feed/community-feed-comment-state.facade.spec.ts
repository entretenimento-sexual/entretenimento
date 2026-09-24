import { describe, expect, it } from 'vitest';

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
    expect(facade.commentsPostId()).toBe('post-1');
    expect(facade.replyPostId()).toBe(null);

    facade.openForReply(target);
    expect(facade.commentsPostId()).toBe('post-1');
    expect(facade.replyPostId()).toBe('post-1');
    expect(facade.postReplyRequestVersion()).toBe(1);

    facade.clearReplyContext(target);
    expect(facade.replyPostId()).toBe(null);
  });

  it('respeita capabilities antes de abrir comentários ou resposta', () => {
    const facade = new CommunityFeedCommentStateFacade();

    facade.toggle(item({ canViewComments: false }));
    facade.openForReply(item({ canComment: false }));

    expect(facade.commentsPostId()).toBe(null);
    expect(facade.replyPostId()).toBe(null);
    expect(facade.postReplyRequestVersion()).toBe(0);
  });

  it('mantém override local e o reconcilia com realtime canônico', () => {
    const facade = new CommunityFeedCommentStateFacade();
    const target = item({ commentCount: 3 });

    expect(facade.commentCount(target)).toBe(3);

    facade.updateCommentCount(target, 7.9);
    expect(facade.commentCount(target)).toBe(7);

    facade.reconcileRealtime([
      realtime({ commentCount: 9 }),
    ]);
    expect(facade.commentCount(target)).toBe(9);

    facade.reconcileRealtime([
      realtime({ type: 'removed', state: 'removed' }),
    ]);
    expect(facade.commentCount(target)).toBe(3);
  });

  it('limpa estado associado ao post removido', () => {
    const facade = new CommunityFeedCommentStateFacade();
    const target = item();

    facade.openForReply(target);
    facade.updateCommentCount(target, 8);
    facade.clearItem('post-1');

    expect(facade.commentsPostId()).toBe(null);
    expect(facade.replyPostId()).toBe(null);
    expect(facade.commentCount(target)).toBe(3);
  });
});
