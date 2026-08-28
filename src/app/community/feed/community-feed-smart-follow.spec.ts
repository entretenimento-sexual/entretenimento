import { TestBed } from '@angular/core/testing';
import { Subject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';
import { CommunityFeedCommentRepository } from '../data-access/community-feed-comment.repository';
import type { CommunityFeedRealtimeChange } from '../data-access/community-feed-realtime.model';
import { CommunityFeedRepository } from '../data-access/community-feed.repository';
import { CommunityFeedComponent } from './community-feed.component';
import { CommunityFeedTimeTickerService } from './community-feed-time-ticker.service';

describe('CommunityFeedComponent smart follow', () => {
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
  const scrollIntoView = vi.fn();

  const capabilities = {
    canDeleteOwn: false,
    canModerate: false,
    canReport: false,
    canReact: false,
    viewerReacted: false,
    canViewComments: false,
    canComment: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

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

  function item(postId: string, publishedAt: number) {
    return {
      postId,
      kind: 'text' as const,
      author: { label: 'Participante', avatarUrl: null },
      text: `Mensagem ${postId}`,
      image: null,
      replyTo: null,
      metrics: { commentCount: 0, reactionCount: 0 },
      capabilities: { ...capabilities },
      publishedAt,
    };
  }

  function addedChange(postId: string, publishedAt: number): CommunityFeedRealtimeChange {
    return {
      type: 'added',
      projection: {
        postId,
        kind: 'text',
        state: 'active',
        metrics: { commentCount: 0, reactionCount: 0 },
        publishedAt,
        eventAt: publishedAt,
      },
    };
  }

  function createFixture(realtime$: Subject<readonly CommunityFeedRealtimeChange[]>) {
    const now = Date.now();
    feedRepository.getPage$.mockReturnValue(of({
      items: [item('post-old', now - 60_000)],
      nextCursor: null,
      generatedAt: now,
    }));
    feedRepository.watchLatestChanges$.mockReturnValue(realtime$);
    feedRepository.getItems$.mockImplementation(({ postIds }: { postIds: string[] }) => of({
      items: postIds.includes('post-new') ? [item('post-new', now)] : [],
      nextCursor: null,
      generatedAt: now,
    }));

    const fixture = TestBed.createComponent(CommunityFeedComponent);
    fixture.componentRef.setInput('communityId', 'community-1');
    fixture.componentRef.setInput('view', 'feed');
    fixture.componentRef.setInput('sourceType', 'community');
    fixture.componentRef.setInput('canInteract', true);
    fixture.componentRef.setInput('viewerRole', 'member');
    fixture.detectChanges();
    return { fixture, now };
  }

  it('acompanha suavemente publicação nova quando o usuário ainda está no topo do fluxo', async () => {
    const realtime$ = new Subject<readonly CommunityFeedRealtimeChange[]>();
    const { fixture, now } = createFixture(realtime$);
    const previousLatest = fixture.nativeElement.querySelector(
      '#community-feed-post-post-old'
    ) as HTMLElement;

    vi.spyOn(previousLatest, 'getBoundingClientRect').mockReturnValue({
      top: 80,
      bottom: 180,
      left: 0,
      right: 600,
      width: 600,
      height: 100,
      x: 0,
      y: 80,
      toJSON: () => ({}),
    } as DOMRect);

    realtime$.next([addedChange('post-new', now)]);
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: 'nearest' })
    );
    expect(fixture.nativeElement.querySelector(
      '#community-feed-post-post-new'
    )?.classList.contains('is-reference-target')).toBe(true);
    expect(fixture.nativeElement.querySelector('.community-feed__new-items')).toBeNull();
  });

  it('preserva a leitura distante do topo e oferece retorno explícito ao conteúdo novo', async () => {
    const realtime$ = new Subject<readonly CommunityFeedRealtimeChange[]>();
    const { fixture, now } = createFixture(realtime$);
    const previousLatest = fixture.nativeElement.querySelector(
      '#community-feed-post-post-old'
    ) as HTMLElement;

    vi.spyOn(previousLatest, 'getBoundingClientRect').mockReturnValue({
      top: -900,
      bottom: -800,
      left: 0,
      right: 600,
      width: 600,
      height: 100,
      x: 0,
      y: -900,
      toJSON: () => ({}),
    } as DOMRect);

    realtime$.next([addedChange('post-new', now)]);
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector(
      '#community-feed-post-post-new'
    )?.classList.contains('is-reference-target')).toBe(false);

    const indicator = fixture.nativeElement.querySelector(
      '.community-feed__new-items button'
    ) as HTMLButtonElement;
    expect(indicator).not.toBeNull();
    expect(indicator.textContent).toContain('1 nova publicação');

    indicator.click();
    fixture.detectChanges();

    expect(scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: 'start' })
    );
    expect(fixture.nativeElement.querySelector(
      '#community-feed-post-post-new'
    )?.classList.contains('is-reference-target')).toBe(true);
    expect(fixture.nativeElement.querySelector('.community-feed__new-items')).toBeNull();
  });

  it('mantém a decisão de preservar a leitura durante uma rajada realtime', async () => {
    const realtime$ = new Subject<readonly CommunityFeedRealtimeChange[]>();
    const { fixture, now } = createFixture(realtime$);
    const previousLatest = fixture.nativeElement.querySelector(
      '#community-feed-post-post-old'
    ) as HTMLElement;

    vi.spyOn(previousLatest, 'getBoundingClientRect').mockReturnValue({
      top: -900,
      bottom: -800,
      left: 0,
      right: 600,
      width: 600,
      height: 100,
      x: 0,
      y: -900,
      toJSON: () => ({}),
    } as DOMRect);

    feedRepository.getItems$
      .mockReturnValueOnce(of({
        items: [item('post-new-1', now + 1_000)],
        nextCursor: null,
        generatedAt: now + 1_000,
      }))
      .mockReturnValueOnce(of({
        items: [item('post-new-2', now + 2_000)],
        nextCursor: null,
        generatedAt: now + 2_000,
      }));

    realtime$.next([addedChange('post-new-1', now + 1_000)]);
    realtime$.next([addedChange('post-new-2', now + 2_000)]);
    fixture.detectChanges();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();

    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(fixture.componentInstance.unseenNewPostCount()).toBe(2);

    const indicator = fixture.nativeElement.querySelector(
      '.community-feed__new-items button'
    ) as HTMLButtonElement;
    expect(indicator).not.toBeNull();
    expect(indicator.textContent).toContain('2 novas publicações');
  });

  it('preserva novidades externas enquanto localiza uma publicação própria', async () => {
    const realtime$ = new Subject<readonly CommunityFeedRealtimeChange[]>();
    const { fixture, now } = createFixture(realtime$);
    const ownHydration$ = new Subject<{
      items: ReturnType<typeof item>[];
      nextCursor: null;
      generatedAt: number;
    }>();

    feedRepository.getItems$.mockImplementation(
      ({ postIds }: { postIds: string[] }) => {
        if (postIds.includes('post-own')) return ownHydration$;
        if (postIds.includes('post-external')) {
          return of({
            items: [item('post-external', now + 1_000)],
            nextCursor: null,
            generatedAt: now + 1_000,
          });
        }
        return of({ items: [], nextCursor: null, generatedAt: now });
      }
    );

    fixture.componentInstance.followCreatedPost('post-own');
    realtime$.next([addedChange('post-external', now + 1_000)]);
    fixture.detectChanges();

    expect(fixture.componentInstance.unseenNewPostCount()).toBe(1);

    ownHydration$.next({
      items: [item('post-own', now + 2_000)],
      nextCursor: null,
      generatedAt: now + 2_000,
    });
    ownHydration$.complete();
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.componentInstance.unseenNewPostCount()).toBe(1);
    expect(fixture.nativeElement.querySelector(
      '#community-feed-post-post-own'
    )?.classList.contains('is-reference-target')).toBe(true);

    const indicator = fixture.nativeElement.querySelector(
      '.community-feed__new-items button'
    ) as HTMLButtonElement;
    expect(indicator).not.toBeNull();
    expect(indicator.textContent).toContain('1 nova publicação');
  });

  it('reconhece a novidade quando sua âncora entra na zona visível por scroll', async () => {
    const realtime$ = new Subject<readonly CommunityFeedRealtimeChange[]>();
    const { fixture, now } = createFixture(realtime$);
    const previousLatest = fixture.nativeElement.querySelector(
      '#community-feed-post-post-old'
    ) as HTMLElement;

    vi.spyOn(previousLatest, 'getBoundingClientRect').mockReturnValue({
      top: -900,
      bottom: -800,
      left: 0,
      right: 600,
      width: 600,
      height: 100,
      x: 0,
      y: -900,
      toJSON: () => ({}),
    } as DOMRect);

    realtime$.next([addedChange('post-new', now)]);
    fixture.detectChanges();
    await Promise.resolve();
    fixture.detectChanges();

    expect(fixture.componentInstance.unseenNewPostCount()).toBe(1);
    expect(fixture.nativeElement.querySelector('.community-feed__new-items')).not.toBeNull();

    const newPost = fixture.nativeElement.querySelector(
      '#community-feed-post-post-new'
    ) as HTMLElement;
    vi.spyOn(newPost, 'getBoundingClientRect').mockReturnValue({
      top: 90,
      bottom: 190,
      left: 0,
      right: 600,
      width: 600,
      height: 100,
      x: 0,
      y: 90,
      toJSON: () => ({}),
    } as DOMRect);

    window.dispatchEvent(new Event('scroll'));
    fixture.detectChanges();

    expect(fixture.componentInstance.unseenNewPostCount()).toBe(0);
    expect(fixture.nativeElement.querySelector('.community-feed__new-items')).toBeNull();
  });
});