import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function video(ownerUid: string, id: string): IPublicVideoItem {
  const now = Date.now();

  return {
    id,
    ownerUid,
    mediaType: 'VIDEO',
    assetAccess: 'SIGNED_URL',
    posterAccess: 'SIGNED_URL',
    title: `Vídeo ${id}`,
    description: null,
    alt: `Vídeo ${id}`,
    mimeType: 'video/mp4',
    sizeBytes: 1_024,
    durationMs: 12_000,
    createdAt: now - 10_000,
    publishedAt: now - 8_000,
    updatedAt: now - 5_000,
    lastViewedAt: null,
    visibility: 'PUBLIC',
    orderIndex: 0,
    moderationStatus: 'APPROVED',
    moderationReason: null,
    reactionsEnabled: true,
    commentsEnabled: true,
    ratingsEnabled: true,
    viewsCount: 10,
    uniqueViewersCount: 8,
    reactionsCount: 1,
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
    owner: {
      nickname: `Perfil ${ownerUid}`,
      photoURL: null,
      gender: null,
      orientation: null,
      municipio: null,
      estado: null,
    },
    url: `https://example.test/${id}.mp4?token=temporary`,
    posterUrl: `https://example.test/${id}.jpg?token=temporary`,
    accessExpiresAt: now + 300_000,
  };
}

describe('PublicVideoViewerComponent discovery context', () => {
  let fixture: ComponentFixture<PublicVideoViewerComponent>;

  const data: IPublicVideoViewerData = {
    ownerUid: 'friend-1',
    items: [
      video('friend-1', 'video-1'),
      video('compatible-1', 'video-2'),
    ],
    startIndex: 0,
    source: 'latest',
    continuationContext: {
      connectionOwnerUids: ['friend-1'],
      compatibleOwnerUids: ['compatible-1'],
    },
  };

  beforeEach(async () => {
    vi.spyOn(HTMLMediaElement.prototype, 'pause')
      .mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load')
      .mockImplementation(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => Promise.resolve());

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
          useValue: {
            prepareVideoViewSession$: vi.fn(() => of(void 0)),
            recordVideoView$: vi.fn(() => of(true)),
            recordVideoRetention$: vi.fn(() => of(true)),
          },
        },
        {
          provide: PublicVideoAccessService,
          useValue: {
            hydratePublicVideoUrls$: vi.fn((items: readonly IPublicVideoItem[]) => of(items)),
            refreshPublicVideoUrl$: vi.fn((item: IPublicVideoItem) => of(item)),
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
              degraded: false,
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
            watchSummary$: vi.fn(() => of({ ratingsCount: 0, ratingAverage: 0 })),
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
  });

  afterEach(() => {
    fixture.destroy();
    vi.restoreAllMocks();
  });

  it('liga o autor à rota de terceiro e explica a origem social da mídia ativa', () => {
    const component = fixture.componentInstance;
    let ownerLink = fixture.nativeElement.querySelector(
      '.public-video-viewer__owner'
    ) as HTMLAnchorElement | null;
    let metadata = fixture.nativeElement.querySelector(
      '.public-video-viewer__metadata-stats'
    ) as HTMLElement | null;

    expect(ownerLink?.getAttribute('href')).toBe('/outro-perfil/friend-1');
    expect(ownerLink?.textContent).toContain('Perfil friend-1');
    expect(metadata?.textContent).toContain('Da sua rede');

    component.next();
    fixture.detectChanges();

    ownerLink = fixture.nativeElement.querySelector(
      '.public-video-viewer__owner'
    ) as HTMLAnchorElement | null;
    metadata = fixture.nativeElement.querySelector(
      '.public-video-viewer__metadata-stats'
    ) as HTMLElement | null;

    expect(ownerLink?.getAttribute('href')).toBe('/outro-perfil/compatible-1');
    expect(ownerLink?.textContent).toContain('Perfil compatible-1');
    expect(metadata?.textContent).toContain('Sugestão para você');
  });
});
