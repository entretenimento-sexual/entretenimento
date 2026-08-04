import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import {
  ActivatedRoute,
  ParamMap,
  convertToParamMap,
} from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import { PublicVideoShareService } from 'src/app/core/services/media/public-video-share.service';
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
  playbackSessionToken: 'playback_session_1234567890_abcdefghijk',
  playbackSessionExpiresAt: Date.now() + 10 * 60_000,
};

describe('PublicProfileVideosComponent', () => {
  let component: PublicProfileVideosComponent;
  let routeParamMapSubject: BehaviorSubject<ParamMap>;
  let errorNotification: {
    showError: ReturnType<typeof vi.fn>;
    showWarning: ReturnType<typeof vi.fn>;
  };
  let globalErrorHandler: { handleError: ReturnType<typeof vi.fn> };
  let publicVideoShare: {
    sharePublicVideo: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    routeParamMapSubject = new BehaviorSubject<ParamMap>(
      convertToParamMap({ id: VIDEO.ownerUid })
    );
    errorNotification = {
      showError: vi.fn(),
      showWarning: vi.fn(),
    };
    globalErrorHandler = { handleError: vi.fn() };
    publicVideoShare = {
      sharePublicVideo: vi.fn().mockResolvedValue('copied'),
    };

    TestBed.configureTestingModule({
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: routeParamMapSubject.asObservable(),
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
          provide: PublicVideoShareService,
          useValue: publicVideoShare,
        },
        {
          provide: ErrorNotificationService,
          useValue: errorNotification,
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

  it('mantém feedback ocupado enquanto compartilha o vídeo', async () => {
    publicVideoShare.sharePublicVideo.mockImplementation(async () => {
      expect(component.isVideoSharing(VIDEO)).toBe(true);
      return 'copied';
    });

    await component.shareVideo(VIDEO);

    expect(publicVideoShare.sharePublicVideo).toHaveBeenCalledWith(VIDEO);
    expect(component.isVideoSharing(VIDEO)).toBe(false);
  });

  it('abre automaticamente o vídeo solicitado pela rota canônica', async () => {
    const openVideo = vi.spyOn(component, 'openVideo').mockResolvedValue();
    component.ngOnInit();

    routeParamMapSubject.next(
      convertToParamMap({
        ownerUid: VIDEO.ownerUid,
        videoId: VIDEO.id,
      })
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(openVideo).toHaveBeenCalledTimes(1);
    expect(openVideo).toHaveBeenCalledWith(0);
  });

  it('informa quando um link direto aponta para vídeo indisponível', async () => {
    component.ngOnInit();

    routeParamMapSubject.next(
      convertToParamMap({
        ownerUid: VIDEO.ownerUid,
        videoId: 'video-removido',
      })
    );

    await Promise.resolve();

    expect(errorNotification.showWarning).toHaveBeenCalledWith(
      'Este vídeo não está mais disponível para visitantes.'
    );
  });
});
