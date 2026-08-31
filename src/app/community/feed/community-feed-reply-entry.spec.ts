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

describe('CommunityFeedComponent conversation entry points', () => {
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

  const baseCapabilities = {
    canDeleteOwn: false,
    canModerate: false,
    canReport: false,
    canReact: false,
    viewerReacted: false,
    canViewComments: true,
    canComment: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });

    feedRepository.getPage$.mockReturnValue(of({
      items: [{
        postId: 'post-1',
        kind: 'text',
        author: { label: 'serale', avatarUrl: null },
        text: 'Mensagem que pode receber conversa.',
        image: null,
        replyTo: null,
        metrics: { commentCount: 0, reactionCount: 0 },
        capabilities: { ...baseCapabilities },
        publishedAt: Date.now() - 1_000,
      }],
      nextCursor: null,
      generatedAt: Date.now(),
    }));
    feedRepository.getItems$.mockReturnValue(of({
      items: [],
      nextCursor: null,
      generatedAt: Date.now(),
    }));
    feedRepository.watchLatestChanges$.mockReturnValue(of([]));
    feedRepository.createPost$.mockReturnValue(of({
      communityId: 'community-1',
      postId: 'post-created',
      created: true,
      deduplicated: false,
    }));
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
        {
          provide: AuthSessionService,
          useValue: { currentAuthUser: { uid: 'user-1' } },
        },
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

  function createFixture() {
    const fixture = TestBed.createComponent(CommunityFeedComponent);
    fixture.componentRef.setInput('communityId', 'community-1');
    fixture.componentRef.setInput('view', 'feed');
    fixture.componentRef.setInput('sourceType', 'community');
    fixture.componentRef.setInput('canInteract', true);
    fixture.componentRef.setInput('viewerRole', 'member');
    fixture.detectChanges();
    return fixture;
  }

  it('envia a mensagem principal com Enter e preserva Shift+Enter para nova linha', () => {
    const fixture = createFixture();
    const textarea = fixture.nativeElement.querySelector(
      '#community-feed-post-text'
    ) as HTMLTextAreaElement;

    fixture.componentInstance.postForm.controls.text.setValue('Mensagem por Enter.');
    fixture.detectChanges();

    const shiftEnter = new KeyboardEvent('keydown', {
      key: 'Enter',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(shiftEnter);
    fixture.detectChanges();

    expect(shiftEnter.defaultPrevented).toBe(false);
    expect(feedRepository.createPost$).not.toHaveBeenCalled();

    const enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(enter);
    fixture.detectChanges();

    expect(enter.defaultPrevented).toBe(true);
    expect(feedRepository.createPost$).toHaveBeenCalledTimes(1);
  });

  it('apresenta comentários legados como comentários, sem confundir com respostas do Mural', () => {
    feedRepository.getPage$.mockReturnValue(of({
      items: [{
        postId: 'post-1',
        kind: 'text',
        author: { label: 'serale', avatarUrl: null },
        text: 'Mensagem com histórico anterior.',
        image: null,
        location: null,
        replyTo: null,
        metrics: { commentCount: 1, reactionCount: 0 },
        capabilities: { ...baseCapabilities },
        publishedAt: Date.now() - 1_000,
      }],
      nextCursor: null,
      generatedAt: Date.now(),
    }));

    const fixture = createFixture();
    const toggle = fixture.nativeElement.querySelector(
      '.community-post__comments-toggle'
    ) as HTMLButtonElement;

    expect(toggle.textContent).toContain('Comentários');
    expect(toggle.textContent).toContain('1');
    expect(toggle.textContent).not.toContain('mensagem anterior');
    expect(toggle.textContent).not.toContain('resposta');
    expect(toggle.getAttribute('aria-label')).toContain('1 comentário');
  });

  it('publica resposta à publicação como novo item do Mural e não como comment filho', async () => {
    const fixture = createFixture();
    const replyButton = fixture.nativeElement.querySelector(
      '.community-post__reply'
    ) as HTMLButtonElement;

    expect(replyButton).not.toBeNull();
    expect(replyButton.getAttribute('aria-label')).toBe('Responder à publicação de serale');

    replyButton.click();
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    const replyContext = fixture.nativeElement.querySelector(
      '.feed-comments__reply-target'
    ) as HTMLElement;
    const composer = fixture.nativeElement.querySelector(
      '.feed-comments__composer textarea'
    ) as HTMLTextAreaElement;

    expect(replyContext).not.toBeNull();
    expect(replyContext.textContent).toContain('Respondendo à publicação de serale');
    expect(composer).not.toBeNull();
    expect(document.activeElement).toBe(composer);

    composer.value = 'Resposta que deve subir para o Mural.';
    composer.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();

    const enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    composer.dispatchEvent(enter);
    fixture.detectChanges();

    expect(enter.defaultPrevented).toBe(true);
    expect(commentRepository.createComment$).not.toHaveBeenCalled();
    expect(feedRepository.createPost$).toHaveBeenCalledTimes(1);
    expect(feedRepository.createPost$).toHaveBeenCalledWith(
      expect.objectContaining({
        communityId: 'community-1',
        text: 'Resposta que deve subir para o Mural.',
        replyToPostId: 'post-1',
      })
    );
    expect(feedRepository.getItems$).toHaveBeenCalledWith({
      communityId: 'community-1',
      view: 'feed',
      postIds: ['post-created'],
    });
    expect(fixture.nativeElement.querySelector('app-community-feed-comments')).toBeNull();
  });

  it('mantém a mensagem atual antes da referência e ancora a original no topo', async () => {
    const now = Date.now();
    feedRepository.getPage$.mockReturnValue(of({
      items: [{
        postId: 'reply-1',
        kind: 'text',
        author: { label: 'prfseves RJ', avatarUrl: null },
        text: 'Resposta mais recente.',
        image: null,
        replyTo: {
          postId: 'post-original',
          authorLabel: 'serale',
          textPreview: 'Mensagem original mais antiga.',
          available: true,
        },
        metrics: { commentCount: 0, reactionCount: 0 },
        capabilities: { ...baseCapabilities },
        publishedAt: now,
      }],
      nextCursor: null,
      generatedAt: now,
    }));
    feedRepository.getItems$.mockReturnValue(of({
      items: [{
        postId: 'post-original',
        kind: 'text',
        author: { label: 'serale', avatarUrl: null },
        text: 'Mensagem original mais antiga.',
        image: null,
        replyTo: null,
        metrics: { commentCount: 4, reactionCount: 0 },
        capabilities: { ...baseCapabilities },
        publishedAt: now - 60_000,
      }],
      nextCursor: null,
      generatedAt: now,
    }));

    const fixture = createFixture();
    const replyPost = fixture.nativeElement.querySelector(
      '#community-feed-post-reply-1'
    ) as HTMLElement;
    const currentMessage = replyPost.querySelector('p') as HTMLParagraphElement;
    const reference = replyPost.querySelector(
      '.community-post__reply-context.is-navigable'
    ) as HTMLAnchorElement;

    expect(reference).not.toBeNull();
    expect(reference.getAttribute('href')).toBe('#community-feed-post-post-original');
    expect(currentMessage).not.toBeNull();
    expect(
      currentMessage.compareDocumentPosition(reference)
      & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(fixture.nativeElement.querySelector('#community-feed-post-post-original')).toBeNull();

    reference.click();
    fixture.detectChanges();
    await new Promise((resolve) => setTimeout(resolve, 25));
    fixture.detectChanges();

    expect(feedRepository.getItems$).toHaveBeenCalledWith({
      communityId: 'community-1',
      view: 'feed',
      postIds: ['post-original'],
    });

    const target = fixture.nativeElement.querySelector(
      '#community-feed-post-post-original'
    ) as HTMLElement;
    expect(target).not.toBeNull();
    expect(target.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: 'start' })
    );
    expect(target.classList.contains('is-reference-target')).toBe(true);
    expect(document.activeElement).toBe(target);
  });
});
