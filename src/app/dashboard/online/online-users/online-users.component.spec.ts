// src/app/dashboard/online/online-users/online-users.component.spec.ts
// -----------------------------------------------------------------------------
// OnlineUsersComponent Spec
// -----------------------------------------------------------------------------
//
// Teste mínimo de criação do componente.
//
// Ajustes desta versão:
// - usa Vitest explicitamente;
// - injeta Router com provideRouter;
// - injeta NgRx com provideMockStore;
// - mocka serviços de geolocalização para não acionar navegador;
// - mocka ErrorNotificationService e GlobalErrorHandlerService;
// - mantém o teste pequeno para acompanhar a refatoração gradual do componente.
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OnlineUsersComponent } from './online-users.component';

import { GeolocationService } from '../../../core/services/geolocation/geolocation.service';
import { GeolocationTrackingService } from '../../../core/services/geolocation/geolocation-tracking.service';
import { DistanceCalculationService } from '../../../core/services/geolocation/distance-calculation.service';

import { AccessControlService } from '../../../core/services/autentication/auth/access-control.service';

import { ErrorNotificationService } from '../../../core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../../core/services/error-handler/global-error-handler.service';

import {
  selectCurrentUser,
  selectCurrentUserStatus,
} from '../../../store/selectors/selectors.user/user.selectors';

import { selectGlobalOnlineUsers } from '../../../store/selectors/selectors.user/online.selectors';

describe('OnlineUsersComponent', () => {
  let component: OnlineUsersComponent;
  let fixture: ComponentFixture<OnlineUsersComponent>;

  const geolocationServiceMock = {
    currentPosition$: vi.fn(),
    applyRolePrivacy: vi.fn(),
    queryPermission: vi.fn(),
  };

  const geolocationTrackingMock = {
    stopTracking: vi.fn(),
    startTracking: vi.fn(),
    getLastSnapshot: vi.fn(),
    persistLocationOnce$: vi.fn(),
    persistPublicLocation$: vi.fn(),
  };

  const distanceCalculationMock = {
    calculateDistanceInKm: vi.fn(),
  };

  const accessControlMock = {
    authUid$: of(null),
    canRunOnlineUsers$: of(false),
    profileEligible$: of(false),
  };

  const errorNotificationMock = {
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showInfo: vi.fn(),
    showWarning: vi.fn(),
  };

  const globalErrorHandlerMock = {
    handleError: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    geolocationTrackingMock.getLastSnapshot.mockReturnValue(null);
    distanceCalculationMock.calculateDistanceInKm.mockReturnValue(null);

    await TestBed.configureTestingModule({
      imports: [OnlineUsersComponent],

      providers: [
        provideRouter([]),

        provideMockStore({
          selectors: [
            {
              selector: selectCurrentUserStatus,
              value: 'signed_out',
            },
            {
              selector: selectCurrentUser,
              value: null,
            },
            {
              selector: selectGlobalOnlineUsers,
              value: [],
            },
          ],
        }),

        {
          provide: GeolocationService,
          useValue: geolocationServiceMock,
        },
        {
          provide: GeolocationTrackingService,
          useValue: geolocationTrackingMock,
        },
        {
          provide: DistanceCalculationService,
          useValue: distanceCalculationMock,
        },
        {
          provide: AccessControlService,
          useValue: accessControlMock,
        },
        {
          provide: ErrorNotificationService,
          useValue: errorNotificationMock,
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: globalErrorHandlerMock,
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OnlineUsersComponent);
    component = fixture.componentInstance;

    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});