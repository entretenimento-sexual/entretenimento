import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { CommunityFeedItem } from '../data-access/community-feed.model';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import {
  CommunityFeedReactionContext,
  CommunityFeedReactionFacade,
} from './community-feed-reaction.facade';

const context: CommunityFeedReactionContext = {
  communityId: 'community-1',
  view: 'feed',
  sourceType: 'community',
};

function createItem(overrides: Partial<CommunityFeedItem> = {}): CommunityFeedItem {
  return {
    postId: 'post-1',
    kind: 'text',
    author: {
      label: 'Participante',
      avatarUrl: null,
    },
    text: 'Mensagem do Mural',
    image: null,
    location: null,
    replyTo: null,
    metrics: {
      commentCount: 0,
      reactionCount: 2,
    },
    capabilities: {
      canDeleteOwn: false,
      canModerate: false,
      canReport: true,
      canReact: true,
      viewerReacted: false,
      canViewComments: true,
      canComment: true,
    },
    publishedAt: Date.UTC(2026, 7, 31, 12),
    ...overrides,
  };
}

describe('CommunityFeedReactionFacade', () => {
  const repositoryMock = {
    toggleReaction$: vi.fn(),
  };
  const applicationErrorMock = {
    report: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    repositoryMock.toggleReaction$.mockReset();

    TestBed.configureTestingModule({
      providers: [
        CommunityFeedReactionFacade,
        { provide: CommunityFeedRepository, useValue: repositoryMock },
        { provide: ApplicationErrorService, useValue: applicationErrorMock },
      ],
    });
  });

  function createFacade(): CommunityFeedReactionFacade {
    return TestBed.inject(CommunityFeedReactionFacade);
  }

  it('aplica reação otimista e converge para a confirmação do backend', () => {
    const response$ = new Subject<{
      communityId: string;
      postId: string;
      reacted: boolean;
      reactionCount: number;
    }>();
    repositoryMock.toggleReaction$.mockReturnValue(response$.asObservable());
    const facade = createFacade();
    const item = createItem();
    const states: string[] = [];
    facade.reactionState$.subscribe((state) => states.push(state.status));

    facade.toggleReaction(item, context);

    expect(repositoryMock.toggleReaction$).toHaveBeenCalledWith({
      communityId: 'community-1',
      postId: 'post-1',
      reacted: true,
    });
    expect(facade.viewerReacted(item, 'community-1')).toBe(true);
    expect(facade.reactionCount(item, 'community-1')).toBe(3);
    expect(states.at(-1)).toBe('loading');

    response$.next({
      communityId: 'community-1',
      postId: 'post-1',
      reacted: true,
      reactionCount: 4,
    });
    response$.complete();

    expect(facade.viewerReacted(item, 'community-1')).toBe(true);
    expect(facade.reactionCount(item, 'community-1')).toBe(4);
    expect(states.at(-1)).toBe('idle');
  });

  it('faz rollback do estado otimista e usa o tratamento centralizado em erro', () => {
    repositoryMock.toggleReaction$.mockReturnValue(
      throwError(() => ({
        code: 'functions/resource-exhausted',
        details: { reason: 'community_feed_reaction_rate_limited' },
      }))
    );
    const facade = createFacade();
    const item = createItem();
    const states: string[] = [];
    facade.reactionState$.subscribe((state) => states.push(state.status));

    facade.toggleReaction(item, context);

    expect(facade.viewerReacted(item, 'community-1')).toBe(false);
    expect(facade.reactionCount(item, 'community-1')).toBe(2);
    expect(states.at(-1)).toBe('error');
    expect(applicationErrorMock.report).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        feature: 'community',
        operation: 'toggleReaction',
      })
    );
  });

  it('bloqueia clique duplicado no mesmo post enquanto a mutação está pendente', () => {
    const response$ = new Subject<{
      communityId: string;
      postId: string;
      reacted: boolean;
      reactionCount: number;
    }>();
    repositoryMock.toggleReaction$.mockReturnValue(response$.asObservable());
    const facade = createFacade();
    const item = createItem();
    facade.reactionState$.subscribe();

    facade.toggleReaction(item, context);
    facade.toggleReaction(item, context);

    expect(repositoryMock.toggleReaction$).toHaveBeenCalledTimes(1);

    response$.next({
      communityId: 'community-1',
      postId: 'post-1',
      reacted: true,
      reactionCount: 3,
    });
    response$.complete();
  });

  it('reconcilia contador realtime sem perder o estado otimista do usuário', () => {
    const response$ = new Subject<{
      communityId: string;
      postId: string;
      reacted: boolean;
      reactionCount: number;
    }>();
    repositoryMock.toggleReaction$.mockReturnValue(response$.asObservable());
    const facade = createFacade();
    const item = createItem();
    facade.reactionState$.subscribe();

    facade.toggleReaction(item, context);
    facade.reconcileRealtime([
      {
        type: 'modified',
        projection: {
          postId: 'post-1',
          kind: 'text',
          state: 'active',
          metrics: {
            commentCount: 0,
            reactionCount: 8,
          },
          publishedAt: Date.UTC(2026, 7, 31, 12),
          eventAt: Date.UTC(2026, 7, 31, 12, 1),
        },
      },
    ], 'community-1');

    expect(facade.viewerReacted(item, 'community-1')).toBe(true);
    expect(facade.reactionCount(item, 'community-1')).toBe(8);
    expect(facade.viewerReacted(item, 'community-2')).toBe(false);
    expect(facade.reactionCount(item, 'community-2')).toBe(2);

    response$.next({
      communityId: 'community-1',
      postId: 'post-1',
      reacted: true,
      reactionCount: 8,
    });
    response$.complete();
  });

  it('não envia reação quando a capacidade do item está desabilitada', () => {
    repositoryMock.toggleReaction$.mockReturnValue(of({
      communityId: 'community-1',
      postId: 'post-1',
      reacted: true,
      reactionCount: 3,
    }));
    const facade = createFacade();
    const item = createItem({
      capabilities: {
        ...createItem().capabilities,
        canReact: false,
      },
    });
    facade.reactionState$.subscribe();

    facade.toggleReaction(item, context);

    expect(repositoryMock.toggleReaction$).not.toHaveBeenCalled();
  });
});
