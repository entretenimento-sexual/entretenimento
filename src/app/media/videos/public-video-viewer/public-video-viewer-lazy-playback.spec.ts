import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { Observable, Subject, of } from 'rxjs';
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
  }): Promise<{
    component: PublicVideoViewerComponent;
    hydratePublicVideoUrls$: ReturnType<typeof vi.fn>;
  }> {
    const hydratePublicVideoUrls$ = vi.fn(input.hydrate);
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
          useValue: { user$: of({ uid: 'viewer-1' }) },
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
            invalidatePublicVideoAccess: vi.fn(),
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
});
