import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import { PublicProfileVideosComponent } from './public-profile-videos.component';

const VIDEO: IPublicVideoItem = {
  id: 'video-1',
  ownerUid: 'owner-1',
  mediaType: 'VIDEO',
  assetAccess: 'SIGNED_URL',
  posterAccess: 'SIGNED_URL',
  title: 'Vídeo de apresentação',
  description: 'Descrição pública',
  alt: 'Pessoa apresentando o perfil',
  mimeType: 'video/mp4',
  sizeBytes: 1_024,
  durationMs: 30_000,
  createdAt: 1,
  publishedAt: 1,
  updatedAt: 1,
  lastViewedAt: null,
  visibility: 'PUBLIC',
  orderIndex: 0,
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
    safetyScore: 0,
  },
  owner: null,
  url: 'https://example.test/video.mp4',
  posterUrl: 'https://example.test/poster.webp',
  accessExpiresAt: Date.now() + 60_000,
};

describe('PublicProfileVideosComponent', () => {
  let component: PublicProfileVideosComponent;
  let globalErrorHandler: { handleError: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    globalErrorHandler = { handleError: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: of(convertToParamMap({ id: VIDEO.ownerUid })),
          },
        },
        {
          provide: MatDialog,
          useValue: { open: vi.fn() },
        },
        {
          provide: CurrentUserStoreService,
          useValue: { user$: of({ uid: 'viewer-1' }) },
        },
        {
          provide: MediaPublicQueryService,
          useValue: {
            getProfilePublicVideos$: vi.fn(() => of([VIDEO])),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
            showWarning: vi.fn(),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: globalErrorHandler,
        },
      ],
    });

    component = TestBed.runInInjectionContext(
      () => new PublicProfileVideosComponent()
    );
  });

  it('substitui uma capa quebrada pelo fallback sem repetir o erro', () => {
    expect(component.hasUsablePoster(VIDEO)).toBe(true);

    component.onPosterError(VIDEO);
    component.onPosterError(VIDEO);

    expect(component.hasUsablePoster(VIDEO)).toBe(false);
    expect(globalErrorHandler.handleError).toHaveBeenCalledTimes(1);
  });

  it('restaura a tentativa de capa quando a galeria é recarregada', () => {
    component.onPosterError(VIDEO);
    expect(component.hasUsablePoster(VIDEO)).toBe(false);

    component.retry();

    expect(component.hasUsablePoster(VIDEO)).toBe(true);
  });

  it('anuncia de forma acessível qual vídeo está sendo aberto', () => {
    expect(component.isVideoOpening(VIDEO)).toBe(false);
    expect(component.getVideoAriaLabel(VIDEO, 0, 1)).toContain('Abrir');

    component.openingVideoId.set(VIDEO.id);

    expect(component.isVideoOpening(VIDEO)).toBe(true);
    expect(component.getVideoAriaLabel(VIDEO, 0, 1)).toBe(
      'Abrindo Vídeo de apresentação.'
    );
  });
});
