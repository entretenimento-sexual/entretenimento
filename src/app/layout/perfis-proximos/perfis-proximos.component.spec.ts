// src/app/layout/perfis-proximos/perfis-proximos.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { PerfisProximosComponent } from './perfis-proximos.component';
import { GeolocationService } from '../../core/services/geolocation/geolocation.service';
import { UserProfileService } from '../../core/services/user-profile/user-profile.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../core/services/error-handler/global-error-handler.service';
import { CurrentUserStoreService } from '../../core/services/autentication/auth/current-user-store.service';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { AccessControlService } from '../../core/services/autentication/auth/access-control.service';
import { CacheService } from '../../core/services/general/cache/cache.service';
import {
  createStoreTestingMock,
  provideStoreTestingMock,
} from '../../../test/ngrx-store-testing.providers';

describe('PerfisProximosComponent', () => {
  let component: PerfisProximosComponent;
  let fixture: ComponentFixture<PerfisProximosComponent>;

  beforeEach(async () => {
    const storeMock = createStoreTestingMock({
      defaultSelectorValue: {
        list: [],
        loading: false,
        error: null,
        ttlLeftMs: 0,
        key: null,
        currentLocation: null,
        isFresh: true,
        maxDistanceKm: 20,
      },
    });

    await TestBed.configureTestingModule({
      imports: [
        PerfisProximosComponent,
        RouterTestingModule,
        NoopAnimationsModule,
      ],
      providers: [
        ...provideStoreTestingMock(storeMock),
        {
          provide: CacheService,
          useValue: {
            getSync: vi.fn(() => undefined),
            get: vi.fn(() => of(null)),
            set: vi.fn(),
          },
        },
        {
          provide: CurrentUserStoreService,
          useValue: {
            user$: of({ uid: 'u1', emailVerified: true }),
            getLoggedUserUID$: vi.fn(() => of('u1')),
          },
        },
        {
          provide: AuthSessionService,
          useValue: {
            whenReady: vi.fn(() => Promise.resolve()),
          },
        },
        {
          provide: AccessControlService,
          useValue: {
            profileEligible$: of(true),
          },
        },
        {
          provide: GeolocationService,
          useValue: {
            getCurrentLocation: vi.fn(),
            applyRolePrivacy: vi.fn(),
          },
        },
        {
          provide: UserProfileService,
          useValue: {
            updateUserLocation: vi.fn(() => Promise.resolve()),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
            showInfo: vi.fn(),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: vi.fn(),
          },
        },
        {
          provide: MatDialog,
          useValue: {
            open: vi.fn(() => ({ afterClosed: () => of(false) })),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PerfisProximosComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
