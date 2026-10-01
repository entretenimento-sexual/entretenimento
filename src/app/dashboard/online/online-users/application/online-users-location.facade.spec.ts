import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import {
  GeolocationError,
  GeolocationErrorCode,
  GeolocationService,
} from 'src/app/core/services/geolocation/geolocation.service';
import { GeolocationTrackingService } from 'src/app/core/services/geolocation/geolocation-tracking.service';
import { PrivacyDebugLoggerService } from 'src/app/core/services/privacy/privacy-debug-logger.service';
import { OnlineUsersLocationFacade } from './online-users-location.facade';

describe('OnlineUsersLocationFacade', () => {
  const USER = {
    uid: 'u1',
    role: 'premium',
    emailVerified: true,
  } as IUserDados;

  function setup(input?: {
    snapshot?: any;
    permission?: string;
    positionError?: unknown;
  }) {
    const currentPosition$ = vi.fn(() =>
      input?.positionError
        ? throwError(() => input.positionError)
        : of({
            latitude: -22.9,
            longitude: -43.2,
            accuracy: 20,
          })
    );
    const applyRolePrivacy = vi.fn((coords: any) => ({
      coords: {
        ...coords,
        latitude: Number(coords.latitude),
        longitude: Number(coords.longitude),
      },
      policy: { maxDistanceKm: 35 },
    }));
    const persistLocationOnce$ = vi.fn(() => of(void 0));
    const startTracking = vi.fn();
    const stopTracking = vi.fn();
    const getLastSnapshot = vi.fn(() => input?.snapshot ?? null);
    const queryPermission = vi.fn(() =>
      Promise.resolve(input?.permission ?? 'prompt')
    );
    const showError = vi.fn();
    const showSuccess = vi.fn();
    const showInfo = vi.fn();
    const report = vi.fn();
    const log = vi.fn();

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        OnlineUsersLocationFacade,
        {
          provide: GeolocationService,
          useValue: { currentPosition$, applyRolePrivacy },
        },
        {
          provide: GeolocationTrackingService,
          useValue: {
            persistLocationOnce$,
            startTracking,
            stopTracking,
            getLastSnapshot,
            queryPermission,
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: { showError, showSuccess, showInfo },
        },
        {
          provide: ApplicationErrorService,
          useValue: { report },
        },
        {
          provide: PrivacyDebugLoggerService,
          useValue: { log },
        },
      ],
    });

    return {
      facade: TestBed.inject(OnlineUsersLocationFacade),
      currentPosition$,
      applyRolePrivacy,
      persistLocationOnce$,
      startTracking,
      stopTracking,
      getLastSnapshot,
      queryPermission,
      showError,
      showSuccess,
      showInfo,
      report,
    };
  }

  it('obtém, reduz e persiste localização privada antes de iniciar tracking', async () => {
    const {
      facade,
      persistLocationOnce$,
      startTracking,
      showSuccess,
    } = setup();

    await facade.enable(USER, {
      requireUserGesture: false,
      silent: false,
    });

    expect(facade.location()).toEqual({
      latitude: -22.9,
      longitude: -43.2,
    });
    expect(facade.policyMaxDistanceKm()).toBe(35);
    expect(facade.uiDistanceKm()).toBe(35);
    expect(persistLocationOnce$).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({
        latitude: -22.9,
        longitude: -43.2,
      })
    );
    expect(startTracking).toHaveBeenCalledWith('u1');
    expect(showSuccess).toHaveBeenCalledWith(
      'Localização ativada e usuários carregados.'
    );
    expect(facade.loading()).toBe(false);
  });

  it('usa snapshot local enquanto refina a posição', async () => {
    const { facade, getLastSnapshot, showSuccess } = setup({
      snapshot: {
        latitude: -22.8,
        longitude: -43.1,
      },
    });

    await facade.enable(USER, {
      requireUserGesture: false,
      silent: false,
    });

    expect(getLastSnapshot).toHaveBeenCalled();
    expect(showSuccess).toHaveBeenCalledWith('Localização atualizada.');
  });

  it('mantém snapshot quando a atualização expira por timeout', async () => {
    const timeout = new GeolocationError(
      'timeout',
      GeolocationErrorCode.TIMEOUT
    );
    const { facade, showInfo, report } = setup({
      snapshot: {
        latitude: -22.8,
        longitude: -43.1,
      },
      positionError: timeout,
    });

    await facade.enable(USER, {
      requireUserGesture: false,
      silent: false,
    });

    expect(facade.location()).toEqual({
      latitude: -22.8,
      longitude: -43.1,
    });
    expect(showInfo).toHaveBeenCalledWith(
      'Não foi possível atualizar sua posição agora; usando a última conhecida.'
    );
    expect(report).not.toHaveBeenCalled();
  });

  it('consulta permissão no auto-enable e encerra o estado de checagem', async () => {
    const { facade, queryPermission, currentPosition$ } = setup({
      permission: 'granted',
    });

    await facade.tryAutoEnable(USER);

    expect(queryPermission).toHaveBeenCalledTimes(1);
    expect(currentPosition$).toHaveBeenCalledTimes(1);
    expect(facade.autoCheckDone()).toBe(true);
  });

  it('clampa o raio pela política e publica a distância', () => {
    const { facade } = setup();

    facade.policyMaxDistanceKm.set(20);

    expect(facade.setUiDistance(50)).toBe(20);
    expect(facade.uiDistanceKm()).toBe(20);
    expect(facade.distance$.value).toBe(20);

    expect(facade.stepRange(-100)).toBe(1);
    expect(facade.uiDistanceKm()).toBe(1);
  });

  it('diagnostica erro técnico sem duplicar apresentação canônica', () => {
    const { facade, showError, report } = setup();
    const error = new Error('geo failed');

    facade.handleError(error);

    expect(showError).toHaveBeenCalledWith('geo failed');
    expect(report).toHaveBeenCalledWith(error, {
      feature: 'online-users',
      operation: 'OnlineUsersLocationFacade.handleError',
      fallbackMessage: 'geo failed',
      presentation: { surface: 'none', severity: 'error' },
      metadata: {
        scope: 'OnlineUsersLocationFacade',
      },
    });
  });
});
