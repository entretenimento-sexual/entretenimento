import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  ParamMap,
  convertToParamMap,
} from '@angular/router';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import {
  IPublicProfileVideoCursor,
  PublicProfileVideoPaginationService,
} from 'src/app/core/services/media/public-profile-video-pagination.service';
import { PublicVideoShareService } from 'src/app/core/services/media/public-video-share.service';
import { PublicVideoViewerLauncherService } from '../public-video-viewer/public-video-viewer-launcher.service';
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
  let publicUserQuery: { getPublicUserById$: ReturnType<typeof vi.fn> };
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
  let videoViewerLauncher: {
    open$: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    routeParamMapSubject = new BehaviorSubject<ParamMap>(
      convertToParamMap({ id: VIDEO.ownerUid })
    );
    publicUserQuery = {
      getPublicUserById$: vi.fn((uid: string) => of({
        uid,
        nickname: 'Perfil público',
        identityCode: 'mulher',
        orientation: 'bissexual',
        municipio: 'Rio de Janeiro',
        estado: 'RJ',
      })),
    };
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
    videoViewerLauncher = {
      open$: vi.fn(() => of(void 0)),
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
          provide: CurrentUserStoreService,
          useValue: { user$: of({ uid: 'viewer-1' }) },
        },
        {
          provide: MediaPublicQueryService,
          useValue: mediaPublicQuery,
        },
        {
          provide: FirestoreUserQueryService,
          useValue: publicUserQuery,
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
          provide: PublicVideoViewerLauncherService,
          useValue: videoViewerLauncher,
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

  it('retorna ao perfil próprio e ao perfil visitado sem usar /perfil/:uid', () => {
    expect(component.profileReturnRoute(VIDEO.ownerUid, 'viewer-1')).toEqual([
      '/outro-perfil', VIDEO.ownerUid,
    ]);
    expect(component.profileReturnRoute(VIDEO.ownerUid, VIDEO.ownerUid)).toEqual([
      '/perfil',
    ]);
  });

  it('usa somente identidade pública reconhecida no cabeçalho de vídeos', () => {
    const identities: Array<{
      nickname: string;
      identityShortLabel?: string | null;
      orientationShortLabel?: string | null;
    } | null> = [];
    const subscription = component.profileIdentity$.subscribe(identity => identities.push(identity));

    expect(publicUserQuery.getPublicUserById$).toHaveBeenCalledWith(VIDEO.ownerUid);
    expect(identities.at(-1)).toMatchObject({
      nickname: 'Perfil público',
      identityShortLabel: 'Mulher',
      orientationShortLabel: 'Bi',
    });
    subscription.unsubscribe();
  });

  it('não atribui orientação individual a perfil de casal', () => {
    publicUserQuery.getPublicUserById$.mockReturnValue(of({
      uid: VIDEO.ownerUid,
      nickname: 'Casal público',
      identityCode: 'casal-ele-ela',
      orientation: 'bissexual',
    }));
    const identities: Array<{ orientationShortLabel?: string | null } | null> = [];
    const subscription = component.profileIdentity$.subscribe(identity => identities.push(identity));

    expect(identities.at(-1)?.orientationShortLabel).toBeUndefined();
    subscription.unsubscribe();
  });

  it('não expõe identidade de outro UID e ignora respostas antigas ao navegar', () => {
    const pending = new Subject<{ uid: string; nickname: string } | null>();
    publicUserQuery.getPublicUserById$.mockImplementation((uid: string) =>
      uid === VIDEO.ownerUid ? pending : of({ uid, nickname: 'Novo perfil' })
    );

    const identities: Array<{ nickname: string } | null> = [];
    const subscription = component.profileIdentity$.subscribe(identity => identities.push(identity));
    routeParamMapSubject.next(convertToParamMap({ id: 'owner-2' }));
    pending.next({ uid: VIDEO.ownerUid, nickname: 'Perfil anterior' });

    expect(identities.at(-1)?.nickname).toBe('Novo perfil');
    expect(identities.some(identity => identity?.nickname === 'Perfil anterior')).toBe(false);
    subscription.unsubscribe();
  });

  it('oculta identidade quando a leitura pública não pertence ao proprietário', () => {
    publicUserQuery.getPublicUserById$.mockReturnValue(of({
      uid: 'outro-uid', nickname: 'Não autorizado',
    }));
    const identities: Array<{ nickname: string } | null> = [];
    const subscription = component.profileIdentity$.subscribe(identity => identities.push(identity));

    expect(identities.at(-1)).toBeNull();
    subscription.unsubscribe();
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

  it('abre o viewer pelo launcher canônico com contexto de perfil', async () => {
    const subscription = component.state$.subscribe();

    component.openVideo(0);

    expect(videoViewerLauncher.open$).toHaveBeenCalledWith({
      items: [VIDEO],
      startIndex: 0,
      source: 'profile',
      profileContinuationCursor: NEXT_CURSOR,
    });

    await Promise.resolve();
    subscription.unsubscribe();
  });

  it('não abre outro vídeo quando o índice está inválido ou o cartão ficou obsoleto', () => {
    const subscription = component.state$.subscribe();

    component.openVideo(-1);
    component.openVideo(1);
    component.openVideo(0, VIDEO_2);
    component.openVideo(0, { ...VIDEO, ownerUid: 'different-owner' });

    expect(videoViewerLauncher.open$).not.toHaveBeenCalled();
    expect(component.viewerOpening()).toBe(false);

    component.openVideo(0, VIDEO);
    expect(videoViewerLauncher.open$).toHaveBeenCalledTimes(1);
    subscription.unsubscribe();
  });

  it('identifica cartões pelo par proprietário e vídeo', () => {
    expect(component.trackByVideoId(0, VIDEO)).toBe('owner-1:video-1');
    expect(component.trackByVideoId(0, { ...VIDEO, ownerUid: 'owner-2' }))
      .toBe('owner-2:video-1');
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

  it('preserves the gallery render window while loading additional pages', () => {
    const generate = (page: number) => Array.from({ length: 12 }, (_, index) => ({
      ...VIDEO, id: `item-${page}-${index}`, orderIndex: page * 12 + index,
    }));
    videoPagination.loadPage$.mockImplementation(
      (_uid: string, options: { cursor?: IPublicProfileVideoCursor | null }) => {
        const page = Number(options.cursor?.documentId ?? 0);
        return of({ items: generate(page), nextCursor: page < 3
          ? { documentId: String(page + 1), orderIndex: page, publishedAt: 1 }
          : null, hasMore: page < 3 });
      }
    );
    const states: Array<{ renderStart: number; renderItems: IPublicVideoItem[];
      hasLaterRenderWindow: boolean }> = [];
    const subscription = component.state$.subscribe(state => states.push(state));
    component.loadMoreVideos();
    component.loadMoreVideos();
    component.loadMoreVideos();
    expect(states.at(-1)?.renderStart).toBe(0);
    expect(states.at(-1)?.renderItems[0].id).toBe('item-0-0');
    expect(states.at(-1)?.hasLaterRenderWindow).toBe(true);
    component.showLaterWindow();
    expect(states.at(-1)?.renderStart).toBe(12);
    subscription.unsubscribe();
  });

  it('moves focus and reading position to the new gallery window without resetting page order', () => {
    const generate = (page: number) => Array.from({ length: 12 }, (_, index) => ({
      ...VIDEO, id: `item-${page}-${index}`, orderIndex: page * 12 + index,
    }));
    videoPagination.loadPage$.mockImplementation(
      (_uid: string, options: { cursor?: IPublicProfileVideoCursor | null }) => {
        const page = Number(options.cursor?.documentId ?? 0);
        return of({
          items: generate(page),
          nextCursor: page < 3
            ? { documentId: String(page + 1), orderIndex: page, publishedAt: 1 }
            : null,
          hasMore: page < 3,
        });
      }
    );
    const stateLog: Array<{ renderStart: number; renderItems: IPublicVideoItem[] }> = [];
    const subscription = component.state$.subscribe(state => stateLog.push(state));
    component.loadMoreVideos();
    component.loadMoreVideos();
    component.loadMoreVideos();

    const focus = vi.fn();
    const scrollIntoView = vi.fn();
    Object.assign(component, {
      videoGallery: { nativeElement: { focus, scrollIntoView } },
    });
    component.showLaterWindow();

    expect(stateLog.at(-1)?.renderStart).toBe(12);
    expect(stateLog.at(-1)?.renderItems[0].id).toBe('item-1-0');
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'start', behavior: 'auto',
    });

    component.showEarlierWindow();
    expect(stateLog.at(-1)?.renderStart).toBe(0);
    expect(focus).toHaveBeenCalledTimes(2);

    component.showEarlierWindow();
    expect(focus).toHaveBeenCalledTimes(2);
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

  it('reopens A after A to B to A router reuse without duplicate launches', async () => {
    mediaPublicQuery.getPublicVideoById$.mockImplementation(
      (_ownerUid: string, videoId: string) =>
        of([VIDEO, VIDEO_2].find(item => item.id === videoId) ?? null)
    );
    const openVideo = vi.spyOn(component, 'openVideo')
      .mockImplementation(() => undefined);
    const sub = component.state$.subscribe();

    component.ngOnInit();
    routeParamMapSubject.next(convertToParamMap({
      ownerUid: VIDEO.ownerUid, videoId: VIDEO.id,
    }));
    await Promise.resolve();
    await Promise.resolve();

    routeParamMapSubject.next(convertToParamMap({
      ownerUid: VIDEO.ownerUid, videoId: VIDEO_2.id,
    }));
    await Promise.resolve();
    await Promise.resolve();

    routeParamMapSubject.next(convertToParamMap({
      ownerUid: VIDEO.ownerUid, videoId: VIDEO.id,
    }));
    await Promise.resolve();
    await Promise.resolve();

    expect(openVideo).toHaveBeenCalledTimes(3);
    expect(mediaPublicQuery.getPublicVideoById$).toHaveBeenCalledWith(
      VIDEO.ownerUid, VIDEO.id, { propagateErrors: true }
    );
    expect(errorNotification.showWarning).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

  it('discards the queued A launch when a different owner B arrives immediately', async () => {
    const secondOwner = { ...VIDEO_2, ownerUid: 'owner-2' };
    mediaPublicQuery.getPublicVideoById$.mockImplementation(
      (ownerUid: string, videoId: string) => of(
        ownerUid === VIDEO.ownerUid && videoId === VIDEO.id
          ? VIDEO
          : ownerUid === secondOwner.ownerUid && videoId === secondOwner.id
            ? secondOwner
            : null
      )
    );
    const launch = vi.spyOn(component, 'openVideo')
      .mockImplementation(() => undefined);
    const sub = component.state$.subscribe();

    component.ngOnInit();
    routeParamMapSubject.next(convertToParamMap({
      ownerUid: VIDEO.ownerUid, videoId: VIDEO.id,
    }));
    routeParamMapSubject.next(convertToParamMap({
      ownerUid: secondOwner.ownerUid, videoId: secondOwner.id,
    }));
    await Promise.resolve();
    await Promise.resolve();

    expect(mediaPublicQuery.getPublicVideoById$).toHaveBeenCalledTimes(2);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledWith(0);
    expect(errorNotification.showWarning).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

  it('keeps only the newest A launch after synchronous A to B to A navigation', async () => {
    mediaPublicQuery.getPublicVideoById$.mockImplementation(
      (_ownerUid: string, videoId: string) => of(
        videoId === VIDEO.id ? VIDEO : VIDEO_2
      )
    );
    const launch = vi.spyOn(component, 'openVideo')
      .mockImplementation(() => undefined);
    const sub = component.state$.subscribe();
    component.ngOnInit();

    routeParamMapSubject.next(convertToParamMap({
      ownerUid: VIDEO.ownerUid, videoId: VIDEO.id,
    }));
    routeParamMapSubject.next(convertToParamMap({
      ownerUid: VIDEO.ownerUid, videoId: VIDEO_2.id,
    }));
    routeParamMapSubject.next(convertToParamMap({
      ownerUid: VIDEO.ownerUid, videoId: VIDEO.id,
    }));
    await Promise.resolve();
    await Promise.resolve();

    expect(mediaPublicQuery.getPublicVideoById$).toHaveBeenCalledTimes(3);
    expect(launch).toHaveBeenCalledTimes(1);
    expect(launch).toHaveBeenCalledWith(0);
    expect(errorNotification.showWarning).not.toHaveBeenCalled();
    sub.unsubscribe();
  });

  it('does not open stale videos when owner and video parameters change together', async () => {
    const secondOwnerVideo = { ...VIDEO, id: 'video-other', ownerUid: 'owner-2' };
    mediaPublicQuery.getPublicVideoById$.mockImplementation(
      (ownerUid: string, videoId: string) =>
        of(ownerUid === 'owner-2' && videoId === 'video-other'
          ? secondOwnerVideo : VIDEO)
    );
    const openVideo = vi.spyOn(component, 'openVideo')
      .mockImplementation(() => undefined);
    const sub = component.state$.subscribe();
    component.ngOnInit();
    routeParamMapSubject.next(convertToParamMap({
      ownerUid: VIDEO.ownerUid, videoId: VIDEO.id,
    }));
    await Promise.resolve();
    await Promise.resolve();
    routeParamMapSubject.next(convertToParamMap({
      ownerUid: 'owner-2', videoId: 'video-other',
    }));
    await Promise.resolve();
    await Promise.resolve();

    expect(mediaPublicQuery.getPublicVideoById$).toHaveBeenLastCalledWith(
      'owner-2', 'video-other', { propagateErrors: true }
    );
    expect(mediaPublicQuery.getPublicVideoById$).toHaveBeenCalledTimes(2);
    expect(openVideo).toHaveBeenCalledTimes(2);
    expect(errorNotification.showWarning).not.toHaveBeenCalled();
    sub.unsubscribe();
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

describe('public video gallery window direction', () => {
  it('documents the rendering contract: lower index is more recent', () => {
    const source = readFileSync(
      join(__dirname, './public-profile-videos.component.html'), 'utf8'
    );
    expect(source).toMatch(/showEarlierWindow\(\)"[\s\S]*Mostrar mais recentes/);
    expect(source).toMatch(/showLaterWindow\(\)"[\s\S]*Mostrar anteriores/);
    expect(source).toContain('[viewerUid]="viewerUid"');
    expect(source).not.toContain('class="public-videos-page__back"');
    expect(source).toContain('class="public-videos-page__tab-count"');
    expect(source).toContain('[routerLink]="profileReturnRoute(galleryProfileUid, viewerUid)"');
    expect(source).toContain('<app-public-user-identity');
    expect(source).toContain('[identity]="profileIdentity"');
    expect(source).toContain('density="comfortable"');
    expect(source).toContain('(preview)="openVideo(state.items.indexOf(item), item)"');
    const componentSource = readFileSync(
      join(__dirname, './public-profile-videos.component.ts'), 'utf8'
    );
    expect(componentSource).toContain('getPublicUserById$(');
    expect(componentSource).not.toContain('getUserById$(');
  });
});
