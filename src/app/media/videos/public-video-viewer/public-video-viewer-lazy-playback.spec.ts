import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { BehaviorSubject, Observable, Subject, of } from 'rxjs';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { MediaReactionsService } from 'src/app/core/services/media/media-reactions.service';
import { MediaVideoCommentsService } from 'src/app/core/services/media/media-video-comments.service';
import { MediaVideoRatingsService } from 'src/app/core/services/media/media-video-ratings.service';
import { PublicVideoAccessService } from 'src/app/core/services/media/public-video-access.service';
import { PublicVideoPlaybackExposureService } from 'src/app/core/services/media/public-video-playback-exposure.service';
import { PublicVideoContinuationService } from 'src/app/core/services/media/public-video-continuation.service';
import { VideoViewTrackingService } from 'src/app/core/services/media/video-view-tracking.service';
import {
  IPublicVideoViewerData,
  PublicVideoViewerComponent,
} from './public-video-viewer.component';

const NOW = 1_800_000_000_000;

function createVideo(
  id: string,
  url: string | null
): IPublicVideoItem {
  return {
    id,
    ownerUid: 'owner-1',
    mediaType: 'VIDEO',
    assetAccess: 'SIGNED_URL',
    posterAccess: 'SIGNED_URL',
    title: `Vídeo ${id}`,
    description: null,
    alt: `Vídeo ${id}`,
    mimeType: 'video/mp4',
    sizeBytes: 4_096,
    durationMs: 25_000,
    createdAt: NOW - 10_000,
    publishedAt: NOW - 8_000,
    updatedAt: NOW - 5_000,
    lastViewedAt: null,
    visibility: 'PUBLIC',
    orderIndex: id === 'video-1' ? 0 : 1,
    moderationStatus: 'APPROVED',
    moderationReason: null,
    reactionsEnabled: true,
    commentsEnabled: true,
    ratingsEnabled: true,
    viewsCount: 0,
    uniqueViewersCount: 0,
    reactionsCount: 0,
    commentsCount: 0,
    ratingsCount: 0,
    ratingAverage: 0,
    reportsCount: 0,
    openReportsCount: 0,
    confirmedReportsCount: 0,
    viewScore: 0,
    engagementScore: 0,
    score: 0,
    scoreBreakdown: {
      rankingScore: 0,
      qualityScore: 0,
      engagementScore: 0,
      safetyScore: 100,
    },
    owner: null,
    url,
    posterUrl: `https://example.test/${id}.jpg?token=preview`,
    accessExpiresAt: NOW + 300_000,
  };
}

function playbackVersion(item: IPublicVideoItem): IPublicVideoItem {
  return {
    ...item,
    url: `https://example.test/${item.id}.mp4?token=playback`,
    accessExpiresAt: Date.now() + 300_000,
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('PublicVideoViewerComponent / lazy playback', () => {
  let fixture: ComponentFixture<PublicVideoViewerComponent> | null = null;

  beforeEach(() => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load')
      .mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => Promise.resolve());
  });

  afterEach(() => {
    fixture?.destroy();
    fixture = null;
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  async function createFixture(input: {
    items: IPublicVideoItem[];
    hydrate: (
      items: readonly IPublicVideoItem[]
    ) => Observable<IPublicVideoItem[]>;
    watchExposure?: (ownerUid: string, videoId: string, viewerUid: string) => Observable<boolean>;
  }): Promise<{
    component: PublicVideoViewerComponent;
    hydratePublicVideoUrls$: ReturnType<typeof vi.fn>;
    invalidatePublicVideoAccess: ReturnType<typeof vi.fn>;
    viewer$: BehaviorSubject<{
      uid: string;
      accountStatus?: 'active' | 'moderation_suspended';
    } | null>;
  }> {
    const hydratePublicVideoUrls$ = vi.fn(input.hydrate);
    const invalidatePublicVideoAccess = vi.fn();
    const viewer$ = new BehaviorSubject<{
      uid: string;
      accountStatus?: 'active' | 'moderation_suspended';
    } | null>({
      uid: 'viewer-1',
    });
    const data: IPublicVideoViewerData = {
      ownerUid: 'owner-1',
      items: input.items,
      startIndex: 0,
      source: 'profile',
    };

    await TestBed.configureTestingModule({
      imports: [PublicVideoViewerComponent],
      providers: [
        provideRouter([]),
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: { close: vi.fn() } },
        {
          provide: CurrentUserStoreService,
          useValue: { user$: viewer$.asObservable() },
        },
        {
          provide: VideoViewTrackingService,
          useValue: { recordVideoView$: vi.fn(() => of(void 0)) },
        },
        {
          provide: PublicVideoAccessService,
          useValue: {
            hydratePublicVideoUrls$,
            refreshPublicVideoUrl$: vi.fn((video: IPublicVideoItem) =>
              of(playbackVersion(video))
            ),
            invalidatePublicVideoAccess,
          },
        },
        {
          provide: PublicVideoPlaybackExposureService,
          useValue: {
            watchActiveVideo$: vi.fn(input.watchExposure ?? (() => of(true))),
          },
        },
        {
          provide: PublicVideoContinuationService,
          useValue: {
            loadContinuation$: vi.fn(() => of({
              items: [],
              exhausted: true,
              failed: false,
            })),
          },
        },
        {
          provide: MediaReactionsService,
          useValue: {
            getVideoLikesCount$: vi.fn(() => of(0)),
            isVideoLikedByViewer$: vi.fn(() => of(false)),
            toggleLikeVideo$: vi.fn(() => of({ liked: true })),
          },
        },
        {
          provide: MediaVideoCommentsService,
          useValue: {
            watchVisibleComments$: vi.fn(() => of([])),
            createComment$: vi.fn(() => of('comment-1')),
            replyToComment$: vi.fn(() => of('reply-1')),
            hideComment$: vi.fn(() => of(true)),
            deleteComment$: vi.fn(() => of(true)),
          },
        },
        {
          provide: MediaVideoRatingsService,
          useValue: {
            watchSummary$: vi.fn(() => of({
              ratingsCount: 0,
              ratingAverage: 0,
            })),
            watchViewerRating$: vi.fn(() => of(null)),
            rateVideo$: vi.fn(() => of({ rating: 5 })),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showWarning: vi.fn(),
            showError: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PublicVideoViewerComponent);
    fixture.detectChanges();
    await flushMicrotasks();
    fixture.detectChanges();

    return {
      component: fixture.componentInstance,
      hydratePublicVideoUrls$,
      invalidatePublicVideoAccess,
      viewer$,
    };
  }

  it('promove somente o preview ativo para playback ao abrir o viewer', async () => {
    const preview = createVideo('video-1', null);
    const playback = playbackVersion(preview);
    const context = await createFixture({
      items: [preview],
      hydrate: () => of([playback]),
    });

    expect(context.hydratePublicVideoUrls$).toHaveBeenCalledTimes(1);
    expect(context.hydratePublicVideoUrls$).toHaveBeenCalledWith([preview]);
    expect(context.component.current?.url).toBe(playback.url);

    const player = fixture!.nativeElement.querySelector(
      'video'
    ) as HTMLVideoElement;
    expect(player.getAttribute('src')).toBe(playback.url);
  });

  it('troca de conta solta a URL anterior e reautoriza o vídeo atual', async () => {
    const preview = createVideo('video-1', null);
    const firstPlayback = {
      ...playbackVersion(preview),
      url: 'https://example.test/video-1.mp4?token=viewer-a',
    };
    const secondPlayback = {
      ...playbackVersion(preview),
      url: 'https://example.test/video-1.mp4?token=viewer-b',
    };
    let hydration = 0;
    const context = await createFixture({
      items: [preview],
      hydrate: () => of(hydration++ === 0 ? [firstPlayback] : [secondPlayback]),
    });

    const player = fixture!.nativeElement.querySelector(
      'video'
    ) as HTMLVideoElement;
    expect(player.getAttribute('src')).toBe(firstPlayback.url);

    context.viewer$.next({ uid: 'viewer-2' });
    fixture!.detectChanges();

    expect(context.invalidatePublicVideoAccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'video-1', url: firstPlayback.url })
    );
    expect(player.getAttribute('src')).toBeNull();
    expect(context.component.current?.url).toBeNull();

    await flushMicrotasks();
    fixture!.detectChanges();

    expect(context.hydratePublicVideoUrls$).toHaveBeenCalledTimes(2);
    expect(context.component.current?.url).toBe(secondPlayback.url);
    expect(player.getAttribute('src')).toBe(secondPlayback.url);
  });

  it('destruir o viewer durante hidratação tardia não reaplica playback nem mantém source', async () => {
    const preview = createVideo('video-1', null);
    const response = new Subject<IPublicVideoItem[]>();
    const context = await createFixture({
      items: [preview],
      hydrate: () => response.asObservable(),
    });

    expect(context.hydratePublicVideoUrls$).toHaveBeenCalledTimes(1);

    fixture!.destroy();
    fixture = null;

    response.next([playbackVersion(preview)]);
    response.complete();
    await flushMicrotasks();

    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
  });

  it('descarta playback atrasado do índice anterior após navegação rápida', async () => {
    const firstPreview = createVideo('video-1', null);
    const secondPreview = createVideo('video-2', null);
    const firstResponse = new Subject<IPublicVideoItem[]>();
    const secondResponse = new Subject<IPublicVideoItem[]>();
    const context = await createFixture({
      items: [firstPreview, secondPreview],
      hydrate: (items) => items[0]?.id === 'video-1'
        ? firstResponse.asObservable()
        : secondResponse.asObservable(),
    });

    expect(context.hydratePublicVideoUrls$).toHaveBeenCalledTimes(1);

    context.component.next();
    fixture!.detectChanges();
    await flushMicrotasks();

    expect(context.component.current?.id).toBe('video-2');
    expect(context.hydratePublicVideoUrls$).toHaveBeenCalledTimes(2);

    firstResponse.next([playbackVersion(firstPreview)]);
    firstResponse.complete();
    fixture!.detectChanges();

    expect(context.component.current?.id).toBe('video-2');
    expect(context.component.current?.url).toBeNull();

    const secondPlayback = playbackVersion(secondPreview);
    secondResponse.next([secondPlayback]);
    secondResponse.complete();
    await flushMicrotasks();
    fixture!.detectChanges();

    expect(context.component.current?.id).toBe('video-2');
    expect(context.component.current?.url).toBe(secondPlayback.url);
  });

  it('corta playback e URL ao receber restrição no vídeo atual', async () => {
    const availability = new Subject<boolean>();
    const initial = createVideo('video-1', null);
    const playback = playbackVersion(initial);
    const context = await createFixture({
      items: [initial],
      hydrate: () => of([playback]),
      watchExposure: () => availability.asObservable(),
    });
    const player = fixture!.nativeElement.querySelector('video') as HTMLVideoElement;
    expect(player.getAttribute('src')).toBe(playback.url);

    availability.next(false);
    fixture!.detectChanges();

    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(player.getAttribute('src')).toBeNull();
    expect(context.component.current?.url).toBeNull();
    expect(context.invalidatePublicVideoAccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'video-1' })
    );
    context.component.retryCurrentVideo();
    await flushMicrotasks();
    expect(context.hydratePublicVideoUrls$).toHaveBeenCalledTimes(1);
  });

  it('descarta resposta de hidratação entregue depois da revogação', async () => {
    const availability = new Subject<boolean>();
    const response = new Subject<IPublicVideoItem[]>();
    const initial = createVideo('video-1', null);
    const context = await createFixture({
      items: [initial],
      hydrate: () => response.asObservable(),
      watchExposure: () => availability.asObservable(),
    });

    availability.next(false);
    response.next([playbackVersion(initial)]);
    response.complete();
    await flushMicrotasks();
    fixture!.detectChanges();

    expect(context.component.current?.url).toBeNull();
    const player = fixture!.nativeElement.querySelector('video') as HTMLVideoElement;
    expect(player.getAttribute('src')).toBeNull();
    expect(context.invalidatePublicVideoAccess).toHaveBeenCalled();
  });

  it('não bloqueia o próximo vídeo quando somente o anterior é revogado', async () => {
    const unavailable = new Subject<boolean>();
    const a = createVideo('video-1', null);
    const b = createVideo('video-2', null);
    const context = await createFixture({
      items: [a, b],
      hydrate: (items) => of(items.map(playbackVersion)),
      watchExposure: (_, id) => id === 'video-1'
        ? unavailable.asObservable() : of(true),
    });

    unavailable.next(false);
    context.component.next();
    fixture!.detectChanges();
    await flushMicrotasks();
    fixture!.detectChanges();

    expect(context.component.current?.id).toBe('video-2');
    expect(context.component.current?.url).toBe(playbackVersion(b).url);
  });

  it('ignora revogação tardia de observador cancelado após troca de conta', async () => {
    const original = new Subject<boolean>();
    const replacement = new Subject<boolean>();
    const initial = createVideo('video-1', null);
    const context = await createFixture({
      items: [initial],
      hydrate: () => of([playbackVersion(initial)]),
      watchExposure: (_, __, uid) => uid === 'viewer-1'
        ? original.asObservable() : replacement.asObservable(),
    });

    expect(original.observed).toBe(true);
    context.viewer$.next({ uid: 'viewer-2' });
    fixture!.detectChanges();
    await flushMicrotasks();
    fixture!.detectChanges();

    expect(original.observed).toBe(false);
    expect(replacement.observed).toBe(true);
    original.next(false);
    fixture!.detectChanges();

    const player = fixture!.nativeElement.querySelector('video') as HTMLVideoElement;
    expect(context.component.current?.url).toBe(playbackVersion(initial).url);
    expect(player.getAttribute('src')).toBe(playbackVersion(initial).url);
  });

  it('retoma após novo sinal positivo somente com nova autorização', async () => {
    const availability = new Subject<boolean>();
    const preview = createVideo('video-1', null);
    const oldUrl = {
      ...playbackVersion(preview),
      url: 'https://example.test/video-1.mp4?token=old-revoked',
    };
    const newUrl = {
      ...playbackVersion(preview),
      url: 'https://example.test/video-1.mp4?token=new-authorized',
    };
    let calls = 0;
    const context = await createFixture({
      items: [preview],
      hydrate: () => of([calls++ === 0 ? oldUrl : newUrl]),
      watchExposure: () => availability.asObservable(),
    });
    const player = fixture!.nativeElement.querySelector('video') as HTMLVideoElement;
    expect(player.getAttribute('src')).toBe(oldUrl.url);

    availability.next(false);
    fixture!.detectChanges();
    expect(player.getAttribute('src')).toBeNull();
    expect(context.component.current?.url).toBeNull();
    context.component.retryCurrentVideo();
    expect(context.hydratePublicVideoUrls$).toHaveBeenCalledTimes(1);

    availability.next(true);
    availability.next(true);
    await flushMicrotasks();
    fixture!.detectChanges();

    expect(context.hydratePublicVideoUrls$).toHaveBeenCalledTimes(2);
    expect(context.hydratePublicVideoUrls$).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'video-1', url: null }),
    ]);
    expect(context.invalidatePublicVideoAccess).toHaveBeenCalledWith(
      expect.objectContaining({ url: oldUrl.url })
    );
    expect(player.getAttribute('src')).toBe(newUrl.url);
    expect(context.component.current?.url).toBe(newUrl.url);
  });

  it('não aplica credencial atrasada da hidratação anterior à revogação', async () => {
    const availability = new Subject<boolean>();
    const previous = new Subject<IPublicVideoItem[]>();
    const resumed = new Subject<IPublicVideoItem[]>();
    const preview = createVideo('video-1', null);
    let calls = 0;
    const context = await createFixture({
      items: [preview],
      hydrate: () => (calls++ === 0 ? previous : resumed).asObservable(),
      watchExposure: () => availability.asObservable(),
    });

    availability.next(false);
    availability.next(true);
    await flushMicrotasks();
    expect(context.hydratePublicVideoUrls$).toHaveBeenCalledTimes(2);

    const oldUrl = {
      ...playbackVersion(preview),
      url: 'https://example.test/video-1.mp4?token=obsolete',
    };
    previous.next([oldUrl]);
    previous.complete();
    fixture!.detectChanges();
    expect(context.component.current?.url).toBeNull();

    const newUrl = {
      ...playbackVersion(preview),
      url: 'https://example.test/video-1.mp4?token=renewed',
    };
    resumed.next([newUrl]);
    resumed.complete();
    await flushMicrotasks();
    fixture!.detectChanges();
    expect(context.component.current?.url).toBe(newUrl.url);
  });

  it('não retoma durante suspensão, mesmo quando projeção volta a permitir', async () => {
    const availability = new Subject<boolean>();
    const initial = createVideo('video-1', null);
    const context = await createFixture({
      items: [initial],
      hydrate: () => of([playbackVersion(initial)]),
      watchExposure: () => availability.asObservable(),
    });

    availability.next(false);
    context.viewer$.next({ uid: 'viewer-1', accountStatus: 'moderation_suspended' });
    availability.next(true);
    await flushMicrotasks();
    fixture!.detectChanges();
    expect(context.hydratePublicVideoUrls$).toHaveBeenCalledTimes(1);
    expect(context.component.current?.url).toBeNull();

    context.viewer$.next({ uid: 'viewer-1', accountStatus: 'active' });
    await flushMicrotasks();
    fixture!.detectChanges();
    expect(context.hydratePublicVideoUrls$).toHaveBeenCalledTimes(2);
    expect(context.component.current?.url).toBe(playbackVersion(initial).url);
  });

  it('falha de reautorização não gera loop diante de true repetido', async () => {
    const availability = new Subject<boolean>();
    const preview = createVideo('video-1', null);
    let calls = 0;
    const context = await createFixture({
      items: [preview],
      hydrate: () => of([calls++ === 0 ? playbackVersion(preview) : preview]),
      watchExposure: () => availability.asObservable(),
    });

    availability.next(false);
    availability.next(true);
    availability.next(true);
    await flushMicrotasks();
    fixture!.detectChanges();

    expect(context.component.current?.url).toBeNull();
    expect(context.hydratePublicVideoUrls$).toHaveBeenCalledTimes(2);
    await flushMicrotasks();
    expect(context.hydratePublicVideoUrls$).toHaveBeenCalledTimes(2);
  });

  it('interrompe o vídeo quando a conta atual é suspensa', async () => {
    const initial = createVideo('video-1', null);
    const context = await createFixture({
      items: [initial],
      hydrate: () => of([playbackVersion(initial)]),
    });

    context.viewer$.next({
      uid: 'viewer-1', accountStatus: 'moderation_suspended',
    });
    fixture!.detectChanges();

    expect(context.component.current?.url).toBeNull();
    const player = fixture!.nativeElement.querySelector('video') as HTMLVideoElement;
    expect(player.getAttribute('src')).toBeNull();
    expect(context.invalidatePublicVideoAccess).toHaveBeenCalled();
  });

});
