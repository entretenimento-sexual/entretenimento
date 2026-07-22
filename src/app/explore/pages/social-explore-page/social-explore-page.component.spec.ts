import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from 'src/app/core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { PhotoViewTrackingService } from 'src/app/core/services/media/photo-view-tracking.service';
import { UserIntentStatusService } from 'src/app/core/services/discovery/user-intent-status.service';
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
          provide: ErrorNotificationService,
          useValue: {
            showWarning: vi.fn(),
            showError: vi.fn(),
            showSuccess: vi.fn(),
          },
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

  it('usa a rota canônica para adicionar foto', () => {
    const link = fixture.debugElement.query(
      By.css('a[aria-label="Adicionar foto"]')
    )?.nativeElement as HTMLAnchorElement | undefined;

    expect(link).toBeTruthy();
    expect(link?.getAttribute('href')).toBe('/media/perfil/u1/fotos/upload');
  });

  it('abre o editor de momento sob demanda', async () => {
    expect(
      fixture.debugElement.query(By.css('app-user-intent-status-composer'))
    ).toBeNull();

    fixture.debugElement
      .query(By.css('.feed-composer__moment'))
      .triggerEventHandler('click');
    fixture.detectChanges();
    await fixture.whenStable();

    expect(
      fixture.debugElement.query(By.css('app-user-intent-status-composer'))
    ).toBeTruthy();
  });
});
