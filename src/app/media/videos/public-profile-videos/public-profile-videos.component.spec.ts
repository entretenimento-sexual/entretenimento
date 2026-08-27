import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import {
  ActivatedRoute,
  ParamMap,
  convertToParamMap,
} from '@angular/router';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import {
  IPublicProfileVideoCursor,
  PublicProfileVideoPaginationService,
} from 'src/app/core/services/media/public-profile-video-pagination.service';
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
};

const VIDEO_2: IPublicVideoItem = {
  ...VIDEO,
  id: 'video-2',
  title: 'Segundo vídeo',
  url: 'https://example.test/video-2.mp4',
  posterUrl: 'https://example.test/poster-2.webp',
  orderIndex: 1,
};

const NEXT_CURSOR: IPublicProfileVideoCursor = {
  orderIndex: 0,
  publishedAt: 1,
  documentId: VIDEO.id,
};

describe('PublicProfileVideosComponent', () => {
  let component: PublicProfileVideosComponent;
  let routeParamMapSubject: BehaviorSubject<ParamMap>;
  let mediaPublicQuery: {
    getProfilePublicVideos$: ReturnType<typeof vi.fn>;
    getPublicVideoById$: ReturnType<typeof vi.fn>;
  };
  let videoPagination: {
    loadPage$: ReturnType<typeof vi.fn>;
  };
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
    mediaPublicQuery = {
      getProfilePublicVideos$: vi.fn(() => of([VIDEO])),
      getPublicVideoById$: vi.fn(
        (_ownerUid: string, videoId: string) =>
          of(videoId === VIDEO.id ? VIDEO : null)
      ),
    };
    videoPagination = {
      loadPage$: vi.fn(
        (
          _ownerUid: string,
          options: { cursor?: IPublicProfileVideoCursor | null }
        ) => options.cursor
          ? of({
            items: [VIDEO_2],
            nextCursor: null,
            hasMore: false,
          })
          : of({
            items: [VIDEO],
            nextCursor: NEXT_CURSOR,
            hasMore: true,
          })
      ),
    };
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
          useValue: mediaPublicQuery,
        },
        {
          provide: PublicProfileVideoPaginationService,
          useValue: videoPagination,
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

    component.shareVideo(VIDEO);

    expect(publicVideoShare.sharePublicVideo).toHaveBeenCalledWith(VIDEO);
    expect(component.isVideoSharing(VIDEO)).toBe(true);

    await Promise.resolve();
    await Promise.resolve();

    expect(component.isVideoSharing(VIDEO)).toBe(false);
  });

  it('carrega a galeria em páginas e não usa a leitura completa legada', () => {
    const states: Array<{
      status: string;
      items: IPublicVideoItem[];
      hasMore: boolean;
      loadingMore: boolean;
    }> = [];
    const subscription = component.state$.subscribe((state) => states.push(state));

    expect(videoPagination.loadPage$).toHaveBeenCalledWith(
      VIDEO.ownerUid,
      { pageSize: 12 }
    );
    expect(mediaPublicQuery.getProfilePublicVideos$).not.toHaveBeenCalled();
    expect(states.at(-1)).toMatchObject({
      status: 'ready',
      items: [VIDEO],
      hasMore: true,
      loadingMore: false,
    });

    component.loadMoreVideos();

    expect(videoPagination.loadPage$).toHaveBeenLastCalledWith(
      VIDEO.ownerUid,
      {
        pageSize: 12,
        cursor: NEXT_CURSOR,
      }
    );
    expect(states.at(-1)).toMatchObject({
      status: 'ready',
      items: [VIDEO, VIDEO_2],
      hasMore: false,
      loadingMore: false,
    });

    subscription.unsubscribe();
  });

  it('descarta página antiga quando retry reinicia a mesma galeria', () => {
    let latestState: {
      items: IPublicVideoItem[];
      hasMore: boolean;
    } | null = null;
    const subscription = component.state$.subscribe((state) => {
      latestState = state;
    });
    const stalePage$ = new Subject<{
      items: IPublicVideoItem[];
      nextCursor: null;
      hasMore: false;
    }>();

    videoPagination.loadPage$.mockImplementationOnce(() => stalePage$);
    component.loadMoreVideos();

    component.retry();
    stalePage$.next({
      items: [VIDEO_2],
      nextCursor: null,
      hasMore: false,
    });

    expect(latestState).toMatchObject({
      items: [VIDEO],
      hasMore: true,
    });
    subscription.unsubscribe();
  });

  it('abre automaticamente o vídeo solicitado pela rota canônica', async () => {
    const openVideo = vi
      .spyOn(component, 'openVideo')
      .mockImplementation(() => undefined);
    routeParamMapSubject.next(
      convertToParamMap({
        ownerUid: VIDEO.ownerUid,
        videoId: VIDEO.id,
      })
    );

    component.ngOnInit();

    await Promise.resolve();
    await Promise.resolve();

    expect(mediaPublicQuery.getPublicVideoById$).toHaveBeenCalledWith(
      VIDEO.ownerUid,
      VIDEO.id,
      { propagateErrors: true }
    );
    expect(videoPagination.loadPage$).not.toHaveBeenCalled();
    expect(mediaPublicQuery.getProfilePublicVideos$).not.toHaveBeenCalled();
    expect(openVideo).toHaveBeenCalledTimes(1);
    expect(openVideo).toHaveBeenCalledWith(0);
  });

  it('informa quando um link direto aponta para vídeo indisponível', async () => {
    routeParamMapSubject.next(
      convertToParamMap({
        ownerUid: VIDEO.ownerUid,
        videoId: 'video-removido',
      })
    );

    component.ngOnInit();

    await Promise.resolve();

    expect(mediaPublicQuery.getPublicVideoById$).toHaveBeenCalledWith(
      VIDEO.ownerUid,
      'video-removido',
      { propagateErrors: true }
    );
    expect(videoPagination.loadPage$).not.toHaveBeenCalled();
    expect(mediaPublicQuery.getProfilePublicVideos$).not.toHaveBeenCalled();
    expect(errorNotification.showWarning).toHaveBeenCalledWith(
      'Este vídeo não está mais disponível para visitantes.'
    );
  });
});
