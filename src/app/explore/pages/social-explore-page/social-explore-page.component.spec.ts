import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { UserIntentStatusService } from 'src/app/core/services/discovery/user-intent-status.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { PhotoUploadFlowService } from 'src/app/core/services/image-handling/photo-upload-flow.service';
import { MediaPublicationService } from 'src/app/core/services/media/media-publication.service';
import { PhotoViewTrackingService } from 'src/app/core/services/media/photo-view-tracking.service';
import { VenueService } from 'src/app/core/services/venues/venue.service';
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
            context$: of({ friendUids: [], personalPhotos: [] }),
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

  it('abre o compositor persistente no campo principal', () => {
    expect(
      fixture.debugElement.query(By.css('app-feed-publication-composer'))
    ).toBeNull();
    expect(
      fixture.debugElement.query(By.css('app-user-intent-status-composer'))
    ).toBeNull();

    const publishButton = fixture.debugElement.query(
      By.css('button[aria-label="Criar publicação persistente"]')
    );

    expect(publishButton.nativeElement.textContent).toContain('Criar publicação');
    publishButton.triggerEventHandler('click');
    fixture.detectChanges();

    expect(
      fixture.debugElement.query(By.css('app-feed-publication-composer'))
    ).toBeTruthy();
    expect(
      fixture.debugElement.query(By.css('app-user-intent-status-composer'))
    ).toBeNull();
  });

  it('mantém o status de 12 horas em ação separada', async () => {
    fixture.debugElement
      .query(By.css('button[aria-label="Criar publicação persistente"]'))
      .triggerEventHandler('click');
    fixture.detectChanges();

    fixture.debugElement
      .query(By.css('button[aria-label="Declarar meu momento por 12 horas"]'))
      .triggerEventHandler('click');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(
      fixture.debugElement.query(By.css('app-feed-publication-composer'))
    ).toBeNull();
    expect(
      fixture.debugElement.query(By.css('app-user-intent-status-composer'))
    ).toBeTruthy();
  });
});
