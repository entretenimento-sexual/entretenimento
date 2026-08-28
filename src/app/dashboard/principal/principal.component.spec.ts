// src/app/dashboard/principal/principal.component.spec.ts
import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject, of } from 'rxjs';

import { IUserDados } from '../../core/interfaces/iuser-dados';
import { IPublicPhotoItem } from '../../core/interfaces/media/i-public-photo-item';
import { IPublicVideoItem } from '../../core/interfaces/media/i-public-video-item';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { UserIntentStatusService } from '../../core/services/discovery/user-intent-status.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { HotPlacesService } from '../../core/services/places/hot-places.service';
import { PrivacyDebugLoggerService } from '../../core/services/privacy/privacy-debug-logger.service';
import { VenueService } from '../../core/services/venues/venue.service';
import { PublicMixedMediaViewerLauncherService } from '../../media/shared/services/public-mixed-media-viewer-launcher.service';
import { selectCurrentUser, selectCurrentUserUid } from '../../store/selectors/selectors.user/user.selectors';
import { PrincipalComponent } from './principal.component';
import { PrincipalFeedItem, PrincipalFeedState } from './principal-feed.model';
import { PrincipalFeedService } from './principal-feed.service';

const EMPTY_FEED_STATE: PrincipalFeedState = {
  status: 'empty',
  items: [],
  photos: [],
  videos: [],
  failedSources: [],
};

function createPhoto(
  ownerUid: string,
  id = 'shared-photo'
): IPublicPhotoItem {
  return {
    id,
    ownerUid,
    mediaType: 'PHOTO',
    assetAccess: 'SIGNED_URL',
    url: `https://example.com/${ownerUid}/${id}.jpg`,
    createdAt: 100,
    publishedAt: 100,
    visibility: 'PUBLIC',
    moderationStatus: 'APPROVED',
    orderIndex: 0,
  } as IPublicPhotoItem;
}

function createVideo(): IPublicVideoItem {
  return {
    id: 'video-1',
    ownerUid: 'owner-2',
    mediaType: 'VIDEO',
    assetAccess: 'SIGNED_URL',
    posterAccess: 'SIGNED_URL',
    title: 'Vídeo recente',
    description: null,
    alt: 'Vídeo recente',
    mimeType: 'video/mp4',
    sizeBytes: 1_024,
    durationMs: 20_000,
    createdAt: 200,
    publishedAt: 200,
    updatedAt: 200,
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
      safetyScore: 100,
    },
    owner: null,
    url: null,
    posterUrl: 'https://example.com/video-1.jpg',
    accessExpiresAt: Date.now() + 300_000,
  };
}

describe('PrincipalComponent', () => {
  let component: PrincipalComponent;
  let fixture: ComponentFixture<PrincipalComponent>;
  let store: MockStore;
  let feedStateSubject: BehaviorSubject<PrincipalFeedState>;

  const mixedViewerLauncher = {
    open$: vi.fn(() => of(void 0)),
  };
  const currentUser = {
    uid: 'u1',
    email: 'x@y.com',
    nickname: 'Alex',
    profileCompleted: true,
    role: 'premium',
    estado: 'RJ',
    municipio: 'Niterói',
  } as unknown as IUserDados;

  beforeEach(async () => {
    vi.clearAllMocks();
    feedStateSubject = new BehaviorSubject<PrincipalFeedState>(EMPTY_FEED_STATE);

    await TestBed.configureTestingModule({
      imports: [RouterTestingModule, PrincipalComponent],
      providers: [
        { provide: Auth, useValue: { currentUser: null } },
        { provide: Firestore, useValue: {} },
        { provide: Functions, useValue: {} },
        {
          provide: PrincipalFeedService,
          useValue: {
            state$: feedStateSubject.asObservable(),
            refresh: vi.fn(),
          },
        },
        {
          provide: PublicMixedMediaViewerLauncherService,
          useValue: mixedViewerLauncher,
        },
        {
          provide: AuthSessionService,
          useValue: {
            ready$: of(true),
            uid$: of('u1'),
            readyUid$: of('u1'),
          },
        },
        {
          provide: UserIntentStatusService,
          useValue: {
            watchCurrentStatus$: vi.fn(() => of(null)),
            watchActiveStatusesForUserRegion$: vi.fn(() => of([])),
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
          provide: HotPlacesService,
          useValue: {
            watchHotPlacesForUserRegion$: vi.fn(() => of([])),
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
          provide: PrivacyDebugLoggerService,
          useValue: { log: vi.fn() },
        },
        provideMockStore({
          initialState: {
            user: { currentUser },
            friendship: {
              requests: [],
              friends: [],
              incoming: [],
              sent: [],
              loading: false,
              error: null,
            },
          },
        }),
      ],
    }).compileComponents();

    store = TestBed.inject(MockStore);
    store.overrideSelector(selectCurrentUser, currentUser);
    store.overrideSelector(selectCurrentUserUid, 'u1');
    store.refreshState();

    fixture = TestBed.createComponent(PrincipalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('não anuncia visualmente que a tela é um feed', () => {
    expect(fixture.debugElement.queryAll(By.css('h1'))).toHaveLength(0);
    expect(fixture.debugElement.query(By.css('.principal-feed'))).toBeTruthy();
    expect(fixture.debugElement.query(By.css('.feed-create-bar'))).toBeTruthy();
    expect(fixture.debugElement.query(By.css('.feed-header'))).toBeNull();
    expect(fixture.debugElement.query(By.css('.feed-shortcuts'))).toBeNull();
  });

  it('usa a rota canônica para adicionar foto', () => {
    const photoLink = fixture.debugElement.query(
      By.css('a[aria-label="Adicionar foto"]')
    )?.nativeElement as HTMLAnchorElement | undefined;

    expect(photoLink).toBeTruthy();
    expect(photoLink?.getAttribute('href')).toBe(
      '/media/perfil/u1/fotos/upload'
    );
  });

  it('materializa o editor de status somente quando solicitado', async () => {
    expect(
      fixture.debugElement.query(By.css('app-user-intent-status-composer'))
    ).toBeNull();

    const prompt = fixture.debugElement.query(
      By.css('.feed-create-bar__prompt')
    );
    prompt.triggerEventHandler('click');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(
      fixture.debugElement.query(By.css('app-user-intent-status-composer'))
    ).toBeTruthy();
  });

  it('mantém radar, locais atuais e fluxo misto na coluna principal', () => {
    expect(
      fixture.debugElement.query(By.css('app-user-intent-status-radar'))
    ).toBeTruthy();
    expect(
      fixture.debugElement.query(By.css('app-hot-places-widget'))
    ).toBeTruthy();
    expect(fixture.debugElement.query(By.css('.feed-stream'))).toBeTruthy();
  });

  it('abre foto preservando a ordem mista e o contexto de continuação', () => {
    const first = createPhoto('owner-a', 'photo-a');
    const video = createVideo();
    const second = createPhoto('owner-b', 'photo-b');
    const feedItems: PrincipalFeedItem[] = [
      {
        id: `profile-photo:${first.ownerUid}:${first.id}`,
        kind: 'profile-photo',
        photo: first,
      },
      {
        id: `profile-video:${video.ownerUid}:${video.id}`,
        kind: 'profile-video',
        video,
      },
      {
        id: `profile-photo:${second.ownerUid}:${second.id}`,
        kind: 'profile-photo',
        photo: second,
      },
    ];
    const continuationContext = {
      connectionOwnerUids: ['friend-1'],
      compatibleOwnerUids: ['compatible-1'],
    };

    feedStateSubject.next({
      status: 'ready',
      items: feedItems,
      photos: [first, second],
      videos: [video],
      failedSources: [],
      continuationContext,
    });
    fixture.detectChanges();

    component.openPhoto(second, feedItems);

    expect(mixedViewerLauncher.open$).toHaveBeenCalledWith({
      items: [first, video, second],
      selected: second,
      source: 'latest',
      continuationContext,
    });
  });

  it('renderiza preview de vídeo e abre a mesma sequência mista', () => {
    const photo = createPhoto('owner-a', 'photo-a');
    const video = createVideo();
    const continuationContext = {
      connectionOwnerUids: ['friend-1'],
      compatibleOwnerUids: ['compatible-1'],
    };
    const feedItems: PrincipalFeedItem[] = [
      {
        id: `profile-photo:${photo.ownerUid}:${photo.id}`,
        kind: 'profile-photo',
        photo,
      },
      {
        id: `profile-video:${video.ownerUid}:${video.id}`,
        kind: 'profile-video',
        video,
      },
    ];

    feedStateSubject.next({
      status: 'ready',
      items: feedItems,
      photos: [photo],
      videos: [video],
      failedSources: [],
      continuationContext,
    });
    fixture.detectChanges();

    const videoCard = fixture.debugElement.query(By.css('app-public-video-card'));
    expect(videoCard).toBeTruthy();

    videoCard.triggerEventHandler('preview');

    expect(mixedViewerLauncher.open$).toHaveBeenCalledWith({
      items: [photo, video],
      selected: video,
      source: 'latest',
      continuationContext,
    });
  });
});
