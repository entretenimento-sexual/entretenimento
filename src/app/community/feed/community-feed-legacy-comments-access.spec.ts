import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';
import { CommunityFeedCommentRepository } from '../data-access/community-feed-comment.repository';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import { CommunityFeedComponent } from './community-feed.component';
import { CommunityFeedTimeTickerService } from './community-feed-time-ticker.service';

describe('CommunityFeedComponent legacy comments access', () => {
  const feedRepository = {
    getPage$: vi.fn(),
    getItems$: vi.fn(),
    watchLatestChanges$: vi.fn(),
    createPost$: vi.fn(),
    moderatePost$: vi.fn(),
    toggleReaction$: vi.fn(),
  };
  const commentRepository = {
    getPage$: vi.fn(),
    createComment$: vi.fn(),
    moderateComment$: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    feedRepository.getItems$.mockReturnValue(of({
      items: [],
      nextCursor: null,
      generatedAt: Date.now(),
    }));
    feedRepository.watchLatestChanges$.mockReturnValue(of([]));
    commentRepository.getPage$.mockReturnValue(of({
      items: [],
      nextCursor: null,
      generatedAt: Date.now(),
    }));

    TestBed.configureTestingModule({
      imports: [CommunityFeedComponent],
      providers: [
        { provide: CommunityFeedRepository, useValue: feedRepository },
        { provide: CommunityFeedCommentRepository, useValue: commentRepository },
        { provide: CommunityFeedTimeTickerService, useValue: { now$: of(Date.now()) } },
        { provide: StorageService, useValue: { uploadFile: vi.fn() } },
        { provide: AuthSessionService, useValue: { currentAuthUser: { uid: 'user-1' } } },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
            showSuccess: vi.fn(),
            showWarning: vi.fn(),
          },
        },
        { provide: GlobalErrorHandlerService, useValue: { handleError: vi.fn() } },
      ],
    });
  });

  function createFixture(commentCount: number, reactionCount = 0) {
    feedRepository.getPage$.mockReturnValue(of({
      items: [{
        postId: 'post-1',
        kind: 'text',
        author: { label: 'serale', avatarUrl: null },
        text: 'Publicação atual do Mural.',
        image: null,
        replyTo: null,
        metrics: { commentCount, reactionCount },
        capabilities: {
          canDeleteOwn: false,
          canModerate: false,
          canReport: false,
          canReact: false,
          viewerReacted: false,
          canViewComments: true,
          canComment: true,
        },
        publishedAt: Date.now() - 1_000,
      }],
      nextCursor: null,
      generatedAt: Date.now(),
    }));

    const fixture = TestBed.createComponent(CommunityFeedComponent);
    fixture.componentRef.setInput('communityId', 'community-1');
    fixture.componentRef.setInput('view', 'feed');
    fixture.componentRef.setInput('sourceType', 'community');
    fixture.componentRef.setInput('canInteract', true);
    fixture.componentRef.setInput('viewerRole', 'member');
    fixture.detectChanges();
    return fixture;
  }

  it('não oferece comentários quando não existe histórico legado', () => {
    const fixture = createFixture(0);

    expect(fixture.nativeElement.textContent).toContain('Responder');
    expect(fixture.nativeElement.textContent).not.toContain('Conversa');
    expect(
      fixture.nativeElement.querySelector('.community-post__comments-toggle')
    ).toBeNull();
  });

  it('não desenha reação falsa quando não pode interagir e o total é zero', () => {
    const fixture = createFixture(0, 0);
    const reaction = fixture.nativeElement.querySelector(
      '.community-post__reaction, .community-post__action--static'
    ) as HTMLElement | null;

    expect(reaction).toBeNull();
  });

  it('exibe somente métrica neutra de curtidas quando existe atividade real', () => {
    const fixture = createFixture(0, 3);
    const reaction = fixture.nativeElement.querySelector(
      '.community-post__action--static'
    ) as HTMLElement;

    expect(reaction).not.toBeNull();
    expect(reaction.getAttribute('aria-label')).toBe('3 curtidas');
    expect(reaction.textContent).toContain('3 curtidas');
    expect(reaction.querySelector('button')).toBeNull();
  });

  it('oferece acesso a comentários somente quando há comentários existentes', () => {
    const fixture = createFixture(2);
    const commentsAccess = fixture.nativeElement.querySelector(
      '.community-post__comments-toggle'
    ) as HTMLButtonElement;

    expect(commentsAccess).not.toBeNull();
    expect(commentsAccess.textContent).toContain('Comentários');
    expect(commentsAccess.textContent).toContain('2');
    expect(commentsAccess.textContent).not.toContain('mensagens anteriores');
    expect(commentsAccess.textContent).not.toContain('respostas');
    expect(commentsAccess.getAttribute('aria-label')).toContain('2 comentários');

    commentsAccess.click();
    fixture.detectChanges();

    expect(commentsAccess.getAttribute('aria-expanded')).toBe('true');
    expect(
      fixture.nativeElement.querySelector('app-community-feed-comments')
    ).not.toBeNull();
  });
});
