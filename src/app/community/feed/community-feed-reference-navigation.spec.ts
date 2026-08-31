import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';
import type {
  CommunityFeedItem,
  CommunityFeedPage,
} from '../data-access/community-feed.model';
import { CommunityFeedCommentRepository } from '../data-access/community-feed-comment.repository';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import { CommunityHighlightUiService } from '../highlight/community-highlight-ui.service';
import { CommunityFeedComponent } from './community-feed.component';

function item(
  postId: string,
  text: string,
  publishedAt: number,
  replyTo: CommunityFeedItem['replyTo'] = null
): CommunityFeedItem {
  return {
    postId,
    kind: 'text',
    author: { label: `Autor ${postId}`, avatarUrl: null },
    text,
    image: null,
    replyTo,
    metrics: { commentCount: 0, reactionCount: 0 },
    capabilities: {
      canDeleteOwn: false,
      canModerate: false,
      canReport: false,
      canReact: false,
      viewerReacted: false,
      canViewComments: false,
      canComment: false,
    },
    publishedAt,
  };
}

function page(items: readonly CommunityFeedItem[]): CommunityFeedPage {
  return {
    items,
    nextCursor: null,
    generatedAt: Date.now(),
  };
}

describe('CommunityFeedComponent reference navigation', () => {
  const referenced = item(
    'post-original',
    'Publicação original mais antiga.',
    1_000
  );
  const reply = item(
    'post-reply',
    'Resposta que aponta para uma publicação fora da janela inicial.',
    2_000,
    {
      postId: referenced.postId,
      authorLabel: referenced.author.label,
      textPreview: referenced.text ?? 'Publicação no Mural',
      available: true,
    }
  );

  const repositoryMock = {
    getPage$: vi.fn(),
    getItems$: vi.fn(),
    watchLatestChanges$: vi.fn(),
    createPost$: vi.fn(),
    moderatePost$: vi.fn(),
    toggleReaction$: vi.fn(),
  };
  const commentRepositoryMock = {
    getPage$: vi.fn(),
    createComment$: vi.fn(),
    moderateComment$: vi.fn(),
  };
  const highlightUiMock = {
    state$: vi.fn(() => of({
      status: 'ready' as const,
      communityId: 'community-1',
      highlight: null,
      item: null,
      canManage: false,
    })),
    manage$: vi.fn(),
    refresh: vi.fn(),
  };
  const errorNotifierMock = {
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showWarning: vi.fn(),
    showInfo: vi.fn(),
  };
  const globalErrorMock = { handleError: vi.fn() };
  const scrollIntoView = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    repositoryMock.getPage$.mockReturnValue(of(page([reply])));
    repositoryMock.getItems$.mockReturnValue(of(page([referenced])));
    repositoryMock.watchLatestChanges$.mockReturnValue(of([]));

    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    TestBed.configureTestingModule({
      imports: [CommunityFeedComponent],
      providers: [
        { provide: CommunityFeedRepository, useValue: repositoryMock },
        {
          provide: CommunityFeedCommentRepository,
          useValue: commentRepositoryMock,
        },
        { provide: CommunityHighlightUiService, useValue: highlightUiMock },
        { provide: StorageService, useValue: { uploadFile: vi.fn() } },
        {
          provide: AuthSessionService,
          useValue: { currentAuthUser: { uid: 'u1' } },
        },
        { provide: ErrorNotificationService, useValue: errorNotifierMock },
        { provide: GlobalErrorHandlerService, useValue: globalErrorMock },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function create() {
    const fixture = TestBed.createComponent(CommunityFeedComponent);
    fixture.componentRef.setInput('communityId', 'community-1');
    fixture.componentRef.setInput('view', 'feed');
    fixture.componentRef.setInput('sourceType', 'community');
    fixture.detectChanges();
    return fixture;
  }

  it('hidrata a publicação fora da janela, espera renderização e só então navega', async () => {
    const fixture = create();
    const reference = fixture.nativeElement.querySelector(
      '.community-post__reply-context.is-navigable'
    ) as HTMLAnchorElement;

    expect(reference).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('#community-feed-post-post-original')
    ).toBeNull();

    reference.click();
    fixture.detectChanges();

    expect(repositoryMock.getItems$).toHaveBeenCalledWith({
      communityId: 'community-1',
      view: 'feed',
      postIds: ['post-original'],
    });
    expect(
      fixture.nativeElement.querySelector('#community-feed-post-post-original')
    ).not.toBeNull();

    await vi.advanceTimersByTimeAsync(20);
    fixture.detectChanges();

    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: 'start' })
    );
    expect(fixture.componentInstance.referenceNavigationState()).toEqual({
      status: 'idle',
      postId: null,
    });
  });

  it('mostra falha inline sem snackbar e permite tentar a referência novamente', async () => {
    repositoryMock.getItems$.mockReturnValueOnce(of(page([])));
    const fixture = create();
    const reference = fixture.nativeElement.querySelector(
      '.community-post__reply-context.is-navigable'
    ) as HTMLAnchorElement;

    reference.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Publicação original não disponível. Clique para tentar novamente.'
    );
    expect(errorNotifierMock.showError).not.toHaveBeenCalled();
    expect(globalErrorMock.handleError).toHaveBeenCalledTimes(1);
    expect(fixture.componentInstance.referenceNavigationState()).toEqual({
      status: 'error',
      postId: 'post-original',
    });

    repositoryMock.getItems$.mockReturnValue(of(page([referenced])));
    reference.click();
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(20);
    fixture.detectChanges();

    expect(repositoryMock.getItems$).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.textContent).toContain(
      'Publicação original mais antiga.'
    );
    expect(fixture.nativeElement.textContent).not.toContain(
      'Publicação original não disponível. Clique para tentar novamente.'
    );
  });
});