import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IUserIntentStatusCardVm } from 'src/app/core/interfaces/discovery/user-intent-status.interface';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { UserIntentStatusService } from 'src/app/core/services/discovery/user-intent-status.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PhotoUploadFlowService } from 'src/app/core/services/image-handling/photo-upload-flow.service';
import { MediaPublicationService } from 'src/app/core/services/media/media-publication.service';
import { PhotoViewTrackingService } from 'src/app/core/services/media/photo-view-tracking.service';
import { VenueService } from 'src/app/core/services/venues/venue.service';
import { UserIntentStatusComposerComponent } from 'src/app/dashboard/user-intent-status/user-intent-status-composer/user-intent-status-composer.component';
import { FeedPublicationComposerComponent } from '../../components/feed-publication-composer/feed-publication-composer.component';
import { ExploreFeedFacade } from '../../facades/explore-feed.facade';
import { ExplorePersonalMediaService } from '../../services/explore-personal-media.service';
import { SocialExplorePageComponent } from './social-explore-page.component';

const EMPTY_VM = {
  boostedPhotos: [],
  mostViewedPhotos: [],
  topPhotos: [],
  latestPhotos: [],
  sections: [],
  compatibleProfiles: [],
  totalItems: 0,
  hasAnyContent: false,
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

describe('SocialExplorePageComponent', () => {
  let fixture: ComponentFixture<SocialExplorePageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RouterTestingModule, SocialExplorePageComponent],
      providers: [
        {
          provide: ExploreFeedFacade,
          useValue: { vm$: of(EMPTY_VM) },
        },
        {
          provide: ExplorePersonalMediaService,
          useValue: {
            context$: of({ friendUids: ['friend-1'], personalPhotos: [] }),
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
          provide: PhotoViewTrackingService,
          useValue: {
            recordPhotoView$: vi.fn(() => of(void 0)),
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

  it('exibe o próprio compositor de 12 horas e momentos relacionados dentro da timeline', () => {
    const feedList = fixture.debugElement.query(By.css('.feed-list'));
    const ownStatusComposer = feedList.query(
      By.css('app-user-intent-status-composer')
    );
    const relatedStatus = feedList.query(By.css('.feed-intent'));

    expect(ownStatusComposer).toBeTruthy();
    expect(relatedStatus.nativeElement.textContent).toContain('Amiga teste');
    expect(relatedStatus.nativeElement.textContent).toContain('Momento');
    expect(relatedStatus.nativeElement.textContent).toContain('Disponível hoje');
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
