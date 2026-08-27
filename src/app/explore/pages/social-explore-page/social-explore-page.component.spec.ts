import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { BehaviorSubject, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IUserIntentStatusCardVm } from 'src/app/core/interfaces/discovery/user-intent-status.interface';
import { IPublicVideoItem } from 'src/app/core/interfaces/media/i-public-video-item';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { UserIntentStatusService } from 'src/app/core/services/discovery/user-intent-status.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PhotoUploadFlowService } from 'src/app/core/services/image-handling/photo-upload-flow.service';
import { MediaPublicationService } from 'src/app/core/services/media/media-publication.service';
import { MediaReactionsService } from 'src/app/core/services/media/media-reactions.service';
import { VenueService } from 'src/app/core/services/venues/venue.service';
import { CompatibleProfileCandidatesService } from 'src/app/dashboard/discovery/application/compatible-profile-candidates.service';
import { UserIntentStatusComposerComponent } from 'src/app/dashboard/user-intent-status/user-intent-status-composer/user-intent-status-composer.component';
import { PublicMixedMediaViewerLauncherService } from 'src/app/media/shared/services/public-mixed-media-viewer-launcher.service';
import { FeedPublicationComposerComponent } from '../../components/feed-publication-composer/feed-publication-composer.component';
import { ExploreFeedFacade } from '../../facades/explore-feed.facade';
import { ExplorePersonalMediaService } from '../../services/explore-personal-media.service';
import { SocialExplorePageComponent } from './social-explore-page.component';

const EMPTY_VM = {
  boostedPhotos: [],
  mostViewedPhotos: [],
  topPhotos: [],
  latestPhotos: [],
  videoHighlights: [],
  videoHighlightsStatus: 'empty' as const,
  sections: [],
  compatibleProfiles: [
    {
      uid: 'compatible-1',
      nickname: 'Compatível teste',
      photoURL: null,
    },
  ],
  totalItems: 0,
  hasAnyContent: false,
};

const VIDEO_HIGHLIGHT: IPublicVideoItem = {
  id: 'video-1',
  ownerUid: 'owner-1',
  mediaType: 'VIDEO',
  assetAccess: 'SIGNED_URL',
  posterAccess: 'SIGNED_URL',
  title: 'Vídeo em destaque',
  description: null,
  alt: 'Vídeo público em destaque',
  mimeType: 'video/mp4',
  sizeBytes: 2_048,
  durationMs: 12_000,
  createdAt: 1_700_000_000_000,
  publishedAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  lastViewedAt: null,
  visibility: 'PUBLIC',
  orderIndex: 0,
  moderationStatus: 'APPROVED',
  moderationReason: null,
  reactionsEnabled: true,
  commentsEnabled: true,
  ratingsEnabled: true,
  viewsCount: 42,
  uniqueViewersCount: 20,
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
  owner: {
    nickname: 'Perfil vídeo',
    photoURL: null,
    gender: null,
    orientation: null,
    municipio: null,
    estado: null,
  },
  url: null,
  posterUrl: 'https://example.test/poster.webp?token=temporary',
  accessExpiresAt: Date.now() + 300_000,
};

const PERSONAL_VIDEO: IPublicVideoItem = {
  ...VIDEO_HIGHLIGHT,
  id: 'friend-video-1',
  ownerUid: 'friend-1',
  title: 'Vídeo da amiga',
  publishedAt: 1_800_000_000_000,
  createdAt: 1_800_000_000_000,
  updatedAt: 1_800_000_000_000,
  owner: {
    ...VIDEO_HIGHLIGHT.owner!,
    nickname: 'Amiga vídeo',
  },
  url: null,
  posterUrl: 'https://example.test/friend-poster.webp?token=temporary',
};

const FRIEND_STATUS: IUserIntentStatusCardVm = {
  id: 'status-friend-1',
  uid: 'friend-1',
  profile: {
    uid: 'friend-1',
    nickname: 'Amiga teste',
    photoURL: null,
    age: 30,
  },
  availability: 'available_today',
  visibility: 'public_discovery',
  destination: {
    kind: 'region',
    label: 'Niterói',
    region: { uf: 'RJ', city: 'niterói' },
  },
  moderation: { state: 'active' },
  startsAt: Date.now(),
  expiresAt: Date.now() + 60 * 60 * 1000,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  destinationLabel: 'Niterói, RJ',
  availabilityLabel: 'Disponível hoje',
  expiresInLabel: 'expira em 1h',
  isActive: true,
};

type PersonalMediaFixture = {
  friendUids: readonly string[];
  personalPhotos: readonly never[];
  personalVideos: readonly IPublicVideoItem[];
  hasMorePersonalMedia?: boolean;
  loadingInitialPersonalMedia?: boolean;
  loadingMorePersonalMedia?: boolean;
  personalMediaLoadFailed?: boolean;
};

describe('SocialExplorePageComponent', () => {
  let fixture: ComponentFixture<SocialExplorePageComponent>;
  let exploreVmSubject: BehaviorSubject<any>;
  let personalMediaSubject: BehaviorSubject<PersonalMediaFixture>;
  let compatibleProfilesSubject: BehaviorSubject<readonly any[]>;
  let exploreFacade: {
    vm$: ReturnType<BehaviorSubject<any>['asObservable']>;
    retryVideoHighlights: ReturnType<typeof vi.fn>;
  };
  let mixedViewer: {
    open$: ReturnType<typeof vi.fn>;
  };
  let loadMorePersonalMedia: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    exploreVmSubject = new BehaviorSubject<any>(EMPTY_VM);
    personalMediaSubject = new BehaviorSubject<PersonalMediaFixture>({
      friendUids: ['friend-1'],
      personalPhotos: [],
      personalVideos: [],
      hasMorePersonalMedia: false,
      loadingInitialPersonalMedia: false,
      loadingMorePersonalMedia: false,
      personalMediaLoadFailed: false,
    });
    compatibleProfilesSubject = new BehaviorSubject<readonly any[]>([
      {
        uid: 'compatible-1',
        nickname: 'Compatível teste',
        photoURL: null,
      },
    ]);
    exploreFacade = {
      vm$: exploreVmSubject.asObservable(),
      retryVideoHighlights: vi.fn(),
    };
    mixedViewer = {
      open$: vi.fn(() => of(void 0)),
    };
    loadMorePersonalMedia = vi.fn(() => of(false));

    await TestBed.configureTestingModule({
      imports: [RouterTestingModule, SocialExplorePageComponent],
      providers: [
        {
          provide: ExploreFeedFacade,
          useValue: exploreFacade,
        },
        {
          provide: ExplorePersonalMediaService,
          useValue: {
            context$: personalMediaSubject.asObservable(),
            loadMore$: loadMorePersonalMedia,
          },
        },
        {
          provide: CompatibleProfileCandidatesService,
          useValue: {
            profiles$: compatibleProfilesSubject.asObservable(),
          },
        },
        {
          provide: CurrentUserStoreService,
          useValue: {
            user$: of({
              uid: 'u1',
              nickname: 'Serale',
              estado: 'RJ',
              municipio: 'Niterói',
            }),
          },
        },
        {
          provide: AuthSessionService,
          useValue: { readyUid$: of('u1') },
        },
        {
          provide: UserIntentStatusService,
          useValue: {
            watchCurrentStatus$: vi.fn(() => of(null)),
            watchActiveStatusesForUserRegion$: vi.fn(() => of([FRIEND_STATUS])),
            publishStatus$: vi.fn(() => of(void 0)),
            hideCurrentStatus$: vi.fn(() => of(void 0)),
          },
        },
        {
          provide: VenueService,
          useValue: {
            watchVenuesForRegion$: vi.fn(() => of([])),
          },
        },
        {
          provide: PublicMixedMediaViewerLauncherService,
          useValue: mixedViewer,
        },
        {
          provide: MediaReactionsService,
          useValue: {
            isPhotoLikedByViewer$: vi.fn(() => of(false)),
            isVideoLikedByViewer$: vi.fn(() => of(false)),
            toggleLikePhotoWithState$: vi.fn(() =>
              of({ liked: true, reactionsCount: 1, score: 0 })
            ),
            toggleLikeVideoWithState$: vi.fn(() =>
              of({ liked: true, reactionsCount: 1, score: 0 })
            ),
          },
        },
        {
          provide: PhotoUploadFlowService,
          useValue: {
            uploadProcessedPhotoWithProgress$: vi.fn(() => of()),
          },
        },
        {
          provide: MediaPublicationService,
          useValue: {
            publishPhoto$: vi.fn(() => of(void 0)),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showWarning: vi.fn(),
            showError: vi.fn(),
            showSuccess: vi.fn(),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SocialExplorePageComponent);
    fixture.detectChanges();
  });

  it('não exibe título visual de feed', () => {
    expect(fixture.debugElement.queryAll(By.css('h1'))).toHaveLength(0);
    expect(fixture.nativeElement.textContent).not.toContain('Feed');
  });

  it('mantém somente a publicação persistente na barra superior', () => {
    expect(
      fixture.debugElement.query(
        By.css('button[aria-label="Criar publicação persistente"]')
      )
    ).toBeTruthy();
    expect(
      fixture.debugElement.query(
        By.css('button[aria-label="Declarar meu momento por 12 horas"]')
      )
    ).toBeNull();
  });

  it('diferencia o próprio momento de 12 horas dentro da timeline', () => {
    const feedList = fixture.debugElement.query(By.css('.feed-list'));
    const ownStatusComposer = feedList.query(
      By.css('app-user-intent-status-composer')
    );
    const relatedStatus = feedList.query(By.css('.feed-intent'));

    expect(ownStatusComposer).toBeTruthy();
    expect(ownStatusComposer.nativeElement.textContent).toContain('Seu momento · 12h');
    expect(ownStatusComposer.nativeElement.textContent).toContain('Definir momento');
    expect(ownStatusComposer.nativeElement.querySelector('.fa-clock')).toBeTruthy();
    expect(relatedStatus.nativeElement.textContent).toContain('Amiga teste');
    expect(relatedStatus.nativeElement.textContent).toContain('Momento');
    expect(relatedStatus.nativeElement.textContent).toContain('Disponível hoje');
  });

  it('filtra momentos pelos amigos e pelo pool canônico antes do limite regional', () => {
    const statusService = TestBed.inject(UserIntentStatusService) as unknown as {
      watchActiveStatusesForUserRegion$: ReturnType<typeof vi.fn>;
    };

    expect(statusService.watchActiveStatusesForUserRegion$).toHaveBeenCalledWith(
      'u1',
      {
        limit: 24,
        ownerUids: ['friend-1', 'compatible-1'],
      }
    );

    compatibleProfilesSubject.next([
      ...Array.from({ length: 7 }, (_, index) => ({
        uid: `compatible-${index + 1}`,
        nickname: `Compatível ${index + 1}`,
      })),
    ]);
    fixture.detectChanges();

    expect(statusService.watchActiveStatusesForUserRegion$).toHaveBeenLastCalledWith(
      'u1',
      {
        limit: 24,
        ownerUids: [
          'friend-1',
          'compatible-1',
          'compatible-2',
          'compatible-3',
          'compatible-4',
          'compatible-5',
          'compatible-6',
          'compatible-7',
        ],
      }
    );
  });

  it('abre a publicação persistente e recolhe o formulário temporário', () => {
    const statusComposer = fixture.debugElement.query(
      By.css('app-user-intent-status-composer')
    ).componentInstance as UserIntentStatusComposerComponent;

    statusComposer.openComposer();
    expect(statusComposer.isComposerExpanded).toBe(true);

    fixture.debugElement
      .query(By.css('button[aria-label="Criar publicação persistente"]'))
      .triggerEventHandler('click');
    fixture.detectChanges();

    expect(statusComposer.isComposerExpanded).toBe(false);
    expect(
      fixture.debugElement.query(By.css('app-feed-publication-composer'))
    ).toBeTruthy();
  });

  it('exibe descoberta útil quando não existem atualizações pessoais', () => {
    const statusService = TestBed.inject(UserIntentStatusService) as unknown as {
      watchActiveStatusesForUserRegion$: ReturnType<typeof vi.fn>;
    };
    statusService.watchActiveStatusesForUserRegion$.mockReturnValue(of([]));

    const emptyFixture = TestBed.createComponent(SocialExplorePageComponent);
    emptyFixture.detectChanges();

    const emptyState = emptyFixture.debugElement.query(By.css('.feed-empty'));
    const suggestion = emptyFixture.debugElement.query(
      By.css('a[href="/outro-perfil/compatible-1"]')
    );
    const discoveryActions = emptyFixture.debugElement.queryAll(
      By.css('.feed-empty__action')
    );

    expect(emptyState.nativeElement.textContent).toContain(
      'Seu feed começa com conexões'
    );
    expect(emptyState.nativeElement.textContent).toContain('Compatível teste');
    expect(suggestion).toBeTruthy();
    expect(discoveryActions).toHaveLength(3);
    expect(
      discoveryActions.map((action) => action.nativeElement.textContent.trim())
    ).toEqual(['Pessoas', 'Locais', 'Comunidades']);
  });

  it('não mostra vazio falso durante a primeira página pessoal', () => {
    const statusService = TestBed.inject(UserIntentStatusService) as unknown as {
      watchActiveStatusesForUserRegion$: ReturnType<typeof vi.fn>;
    };
    statusService.watchActiveStatusesForUserRegion$.mockReturnValue(of([]));
    personalMediaSubject.next({
      friendUids: ['friend-1'],
      personalPhotos: [],
      personalVideos: [],
      loadingInitialPersonalMedia: true,
    });

    const loadingFixture = TestBed.createComponent(SocialExplorePageComponent);
    loadingFixture.detectChanges();

    const loadingState = loadingFixture.debugElement.query(
      By.css('.feed-empty[role="status"]')
    );

    expect(loadingState.nativeElement.textContent).toContain(
      'Carregando atualizações'
    );
    expect(loadingState.nativeElement.textContent).not.toContain(
      'Seu feed começa com conexões'
    );
  });

  it('oferece busca de novos autores antes do vazio definitivo', () => {
    const statusService = TestBed.inject(UserIntentStatusService) as unknown as {
      watchActiveStatusesForUserRegion$: ReturnType<typeof vi.fn>;
    };
    statusService.watchActiveStatusesForUserRegion$.mockReturnValue(of([]));
    personalMediaSubject.next({
      friendUids: ['friend-1'],
      personalPhotos: [],
      personalVideos: [],
      hasMorePersonalMedia: true,
      loadingInitialPersonalMedia: false,
      loadingMorePersonalMedia: false,
      personalMediaLoadFailed: false,
    });

    const moreOwnersFixture = TestBed.createComponent(SocialExplorePageComponent);
    moreOwnersFixture.detectChanges();

    const state = moreOwnersFixture.debugElement.query(By.css('.feed-empty'));
    const action = moreOwnersFixture.debugElement.query(
      By.css('.feed-empty .feed-pagination button')
    );

    expect(state.nativeElement.textContent).toContain(
      'Ainda há conexões para verificar'
    );
    expect(state.nativeElement.textContent).not.toContain(
      'Seu feed começa com conexões'
    );
    expect(action.nativeElement.textContent).toContain('Buscar mais atualizações');

    action.triggerEventHandler('click');

    expect(loadMorePersonalMedia).toHaveBeenCalledTimes(1);
  });

  it('oferece retry em vez de estado vazio quando a mídia falha', () => {
    const statusService = TestBed.inject(UserIntentStatusService) as unknown as {
      watchActiveStatusesForUserRegion$: ReturnType<typeof vi.fn>;
    };
    statusService.watchActiveStatusesForUserRegion$.mockReturnValue(of([]));
    personalMediaSubject.next({
      friendUids: ['friend-1'],
      personalPhotos: [],
      personalVideos: [],
      hasMorePersonalMedia: true,
      loadingInitialPersonalMedia: false,
      loadingMorePersonalMedia: false,
      personalMediaLoadFailed: true,
    });

    const retryFixture = TestBed.createComponent(SocialExplorePageComponent);
    retryFixture.detectChanges();

    const retryState = retryFixture.debugElement.query(By.css('.feed-empty'));
    const retryButton = retryFixture.debugElement.query(
      By.css('.feed-empty .feed-pagination button')
    );

    expect(retryState.nativeElement.textContent).toContain(
      'Não foi possível concluir o carregamento'
    );
    expect(retryState.nativeElement.textContent).not.toContain(
      'Seu feed começa com conexões'
    );

    retryButton.triggerEventHandler('click');

    expect(loadMorePersonalMedia).toHaveBeenCalledTimes(1);
  });

  it('renderiza vídeos em destaque pelo card compartilhado', () => {
    exploreVmSubject.next({
      ...EMPTY_VM,
      videoHighlights: [VIDEO_HIGHLIGHT],
      videoHighlightsStatus: 'ready',
      totalItems: 1,
      hasAnyContent: true,
    });
    fixture.detectChanges();

    const section = fixture.debugElement.query(By.css('.video-highlights'));
    const card = section.query(By.css('app-public-video-card'));
    const preview = card.query(By.css('.public-video-card__preview'));

    expect(section.nativeElement.textContent).toContain('Vídeos em destaque');
    expect(card.nativeElement.textContent).toContain('Vídeo em destaque');
    expect(card.nativeElement.textContent).toContain('Perfil vídeo');
    expect(preview.attributes['aria-label']).toContain('Assistir Vídeo em destaque');
  });

  it('insere vídeo pessoal de amigo na timeline sem playback pré-hidratado', () => {
    personalMediaSubject.next({
      friendUids: ['friend-1'],
      personalPhotos: [],
      personalVideos: [PERSONAL_VIDEO],
    });
    fixture.detectChanges();

    const card = fixture.debugElement.query(
      By.css('.feed-list app-public-video-card')
    );

    expect(card).toBeTruthy();
    expect(card.nativeElement.textContent).toContain('Vídeo da amiga');
    expect(card.nativeElement.textContent).toContain('Amiga vídeo');
    expect(PERSONAL_VIDEO.url).toBeNull();
  });

  it('abre mídia do feed pelo launcher misto canônico', () => {
    personalMediaSubject.next({
      friendUids: ['friend-1'],
      personalPhotos: [],
      personalVideos: [PERSONAL_VIDEO],
    });
    fixture.detectChanges();

    fixture.componentInstance.openFeedVideo(PERSONAL_VIDEO);

    expect(mixedViewer.open$).toHaveBeenCalledWith({
      items: [PERSONAL_VIDEO],
      selected: PERSONAL_VIDEO,
      source: 'discover',
    });
  });

  it('encaminha comentários do card para o mesmo viewer canônico', () => {
    personalMediaSubject.next({
      friendUids: ['friend-1'],
      personalPhotos: [],
      personalVideos: [PERSONAL_VIDEO],
    });
    fixture.detectChanges();

    const commentsButton = fixture.debugElement.queryAll(
      By.css('.feed-list app-public-media-engagement-actions button')
    )[1];
    commentsButton.triggerEventHandler('click', null);

    expect(mixedViewer.open$).toHaveBeenCalledWith({
      items: [PERSONAL_VIDEO],
      selected: PERSONAL_VIDEO,
      source: 'discover',
    });
  });

  it('busca página remota quando a janela local terminou e o backend ainda tem mídia', () => {
    personalMediaSubject.next({
      friendUids: ['friend-1'],
      personalPhotos: [],
      personalVideos: [],
      hasMorePersonalMedia: true,
      loadingInitialPersonalMedia: false,
      loadingMorePersonalMedia: false,
    });
    fixture.detectChanges();

    fixture.componentInstance.loadMoreFeed();

    expect(loadMorePersonalMedia).toHaveBeenCalledTimes(1);
  });

  it('mantém mídia de compatível além do limite visual de seis sugestões', () => {
    const seventhCompatibleVideo: IPublicVideoItem = {
      ...PERSONAL_VIDEO,
      id: 'compatible-video-7',
      ownerUid: 'compatible-7',
      title: 'Vídeo da sétima compatível',
      owner: {
        ...PERSONAL_VIDEO.owner!,
        nickname: 'Compatível sete',
      },
    };

    compatibleProfilesSubject.next([
      ...Array.from({ length: 6 }, (_, index) => ({
        uid: `compatible-${index + 1}`,
        nickname: `Compatível ${index + 1}`,
      })),
      { uid: 'compatible-7', nickname: 'Compatível sete' },
    ]);
    personalMediaSubject.next({
      friendUids: [],
      personalPhotos: [],
      personalVideos: [seventhCompatibleVideo],
    });
    fixture.detectChanges();

    const card = fixture.debugElement.query(
      By.css('.feed-list app-public-video-card')
    );

    expect(EMPTY_VM.compatibleProfiles).toHaveLength(1);
    expect(card).toBeTruthy();
    expect(card.nativeElement.textContent).toContain('Vídeo da sétima compatível');
    expect(card.nativeElement.textContent).toContain('Compatível sete');
  });

  it('oferece retry explícito quando os vídeos falham', () => {
    exploreVmSubject.next({
      ...EMPTY_VM,
      videoHighlightsStatus: 'error',
    });
    fixture.detectChanges();

    const retryButton = fixture.debugElement.query(
      By.css('.video-highlights__error button')
    );
    retryButton.triggerEventHandler('click');

    expect(exploreFacade.retryVideoHighlights).toHaveBeenCalledTimes(1);
  });

  it('envia a foto e promove a mesma mídia para a publicação persistente', () => {
    const uploadFlow = TestBed.inject(PhotoUploadFlowService) as unknown as {
      uploadProcessedPhotoWithProgress$: ReturnType<typeof vi.fn>;
    };
    const publication = TestBed.inject(MediaPublicationService) as unknown as {
      publishPhoto$: ReturnType<typeof vi.fn>;
    };
    const notifications = TestBed.inject(ErrorNotificationService) as unknown as {
      showSuccess: ReturnType<typeof vi.fn>;
    };

    uploadFlow.uploadProcessedPhotoWithProgress$.mockReturnValue(
      of(
        { type: 'progress' as const, progress: 45 },
        {
          type: 'success' as const,
          result: {
            photoId: 'photo-1',
            url: 'https://example.test/private-photo.webp',
            path: 'users/u1/images/photo.webp',
            fileName: 'photo.webp',
            createdAt: new Date('2026-07-22T20:00:00.000Z'),
          },
        }
      )
    );

    fixture.debugElement
      .query(By.css('button[aria-label="Criar publicação persistente"]'))
      .triggerEventHandler('click');
    fixture.detectChanges();

    const composer = fixture.debugElement.query(
      By.css('app-feed-publication-composer')
    ).componentInstance as FeedPublicationComposerComponent;
    const file = new File(['image'], 'foto.webp', { type: 'image/webp' });

    composer.selectedFile.set(file);
    composer.captionControl.setValue('  Olá\n   mundo  ');
    composer.publish();

    expect(uploadFlow.uploadProcessedPhotoWithProgress$).toHaveBeenCalledWith({
      userId: 'u1',
      processedFile: file,
      originalFileName: 'foto.webp',
      mimeType: 'image/webp',
    });
    expect(publication.publishPhoto$).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUid: 'u1',
        visibility: 'PUBLIC',
        caption: 'Olá mundo',
        commentsEnabled: true,
        commentsPolicy: 'EVERYONE',
        reactionsEnabled: true,
        photo: expect.objectContaining({
          id: 'photo-1',
          ownerUid: 'u1',
          path: 'users/u1/images/photo.webp',
        }),
      })
    );
    expect(notifications.showSuccess).toHaveBeenCalledWith('Publicação enviada.');
  });
});
