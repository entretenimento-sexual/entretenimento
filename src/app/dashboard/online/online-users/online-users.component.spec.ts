// src/app/dashboard/online/online-users/online-users.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MockStore, provideMockStore } from '@ngrx/store/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IUserDados } from '../../../core/interfaces/iuser-dados';
import { AccessControlService } from '../../../core/services/autentication/auth/access-control.service';
import { ErrorNotificationService } from '../../../core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from '../../../core/services/error-handler/global-error-handler.service';
import { DistanceCalculationService } from '../../../core/services/geolocation/distance-calculation.service';
import { GeolocationService } from '../../../core/services/geolocation/geolocation.service';
import { GeolocationTrackingService } from '../../../core/services/geolocation/geolocation-tracking.service';
import { selectGlobalOnlineUsers } from '../../../store/selectors/selectors.user/online.selectors';
import {
  selectCurrentUser,
  selectCurrentUserStatus,
} from '../../../store/selectors/selectors.user/user.selectors';
import { OnlineUsersComponent } from './online-users.component';

describe('OnlineUsersComponent', () => {
  let component: OnlineUsersComponent;
  let fixture: ComponentFixture<OnlineUsersComponent>;
  let store: MockStore;

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

    store = TestBed.inject(MockStore);
    fixture = TestBed.createComponent(OnlineUsersComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('mantém o estado de sessão compacto sem empilhar títulos', () => {
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.online-users__state')).toBeTruthy();
    expect(element.textContent).toContain('Entre na sua conta');
    expect(element.querySelectorAll('h1, h2, h3, h4').length).toBe(0);
  });

  it('mantém os ajustes de proximidade compactos e acessíveis', () => {
    const currentUser = {
      uid: 'u1',
      emailVerified: true,
      profileCompleted: true,
      role: 'premium',
    } as IUserDados;

    store.overrideSelector(selectCurrentUserStatus, 'ready');
    store.overrideSelector(selectCurrentUser, currentUser);
    store.refreshState();

    component.mode = 'nearby';
    component.locationAutoCheckDone.set(true);
    component.userLocation = { latitude: -22.9, longitude: -43.2 };
    component.uiDistanceKm = 10;
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    const toggle = element.querySelector<HTMLButtonElement>('.online-users__toggle');

    expect(element.querySelector('.online-users__toolbar')).toBeTruthy();
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');

    toggle?.click();
    fixture.detectChanges();

    const controls = element.querySelector('.online-users__controls');
    const rangeRow = element.querySelector('.online-users__range-row');

    expect(controls).toBeTruthy();
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(rangeRow?.querySelectorAll('button').length).toBe(2);
    expect(rangeRow?.querySelector('input[type="range"]')).toBeTruthy();
    expect(element.querySelector('[class*="card"], [class*="panel"]')).toBeNull();
  });
});
