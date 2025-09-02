// src/app/core/services/geolocation/geolocation.service.spec.ts
/* ============================================================================
 * Testes do GeolocationService (versão compat TS sem .resolves/.rejects/it.each)
 * ==========================================================================*/

jest.mock('geofire-common', () => ({
  geohashForLocation: jest.fn((_latlng?: [number, number]) => 'hash123456789'),
}));

import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { firstValueFrom, take } from 'rxjs';

import {
  GeolocationService,
  GeolocationError,
  GeolocationErrorCode,
  GeoPolicy,
} from './geolocation.service';
import { geohashForLocation } from 'geofire-common';

type CoordsInit = Partial<GeolocationPosition['coords']>;

function buildPosition(coords: CoordsInit = {}): GeolocationPosition {
  return {
    coords: {
      latitude: 10.123456,
      longitude: -20.987654,
      altitude: null,
      accuracy: 10,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
      ...coords,
    },
    timestamp: Date.now(),
  } as GeolocationPosition;
}

describe('GeolocationService', () => {
  let service: GeolocationService;

  let getCurrentPositionMock: jest.Mock;
  let watchPositionMock: jest.Mock;
  let clearWatchMock: jest.Mock;
  let permissionsQueryMock: jest.Mock;

  const setSecure = (isSecure: boolean, host = 'localhost') => {
    Object.defineProperty(window, 'isSecureContext', { value: isSecure, configurable: true });
    Object.defineProperty(window, 'location', {
      value: { hostname: host } as any,
      configurable: true,
    });
  };

  const setPermissions = (state: PermissionState | 'unsupported') => {
    if (state === 'unsupported') {
      Object.defineProperty(navigator as any, 'permissions', { value: undefined, configurable: true });
    } else {
      permissionsQueryMock = jest.fn().mockResolvedValue({ state });
      Object.defineProperty(navigator as any, 'permissions', {
        value: { query: permissionsQueryMock },
        configurable: true,
      });
    }
  };

  const setGeolocationSuccess = (pos: GeolocationPosition) => {
    getCurrentPositionMock = jest.fn((success: PositionCallback) => success(pos));
    watchPositionMock = jest.fn((success: PositionCallback) => {
      const id = 42;
      setTimeout(() => success(pos), 0);
      setTimeout(
        () => success({ ...pos, coords: { ...pos.coords, latitude: pos.coords.latitude + 0.001 } }),
        5
      );
      return id;
    });
    clearWatchMock = jest.fn();
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: getCurrentPositionMock,
        watchPosition: watchPositionMock,
        clearWatch: clearWatchMock,
      },
      configurable: true,
    });
  };

  const setGeolocationError = (code: 1 | 2 | 3) => {
    getCurrentPositionMock = jest.fn((_s: PositionCallback, err: PositionErrorCallback) => err({ code } as any));
    watchPositionMock = jest.fn((_s: PositionCallback, err: PositionErrorCallback) => err({ code } as any));
    clearWatchMock = jest.fn();
    Object.defineProperty(navigator, 'geolocation', {
      value: {
        getCurrentPosition: getCurrentPositionMock,
        watchPosition: watchPositionMock,
        clearWatch: clearWatchMock,
      },
      configurable: true,
    });
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [GeolocationService],
    });
    service = TestBed.inject(GeolocationService);

    setSecure(true, 'localhost');
    setPermissions('granted');
    setGeolocationSuccess(buildPosition());

    jest.spyOn(console, 'error').mockImplementation(() => { });
    jest.spyOn(console, 'warn').mockImplementation(() => { });
    jest.spyOn(console, 'log').mockImplementation(() => { });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ---------------------------------------------------------
  // Pré-checagens
  // ---------------------------------------------------------
  it('isSupported: true quando navigator.geolocation existe', () => {
    expect(service.isSupported()).toBe(true);
  });

  it('isSupported: false quando navigator.geolocation não existe', () => {
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
    expect(service.isSupported()).toBe(false);
  });

  it('isSecureContext: true em HTTPS', () => {
    setSecure(true, 'qualquer.com');
    expect(service.isSecureContext()).toBe(true);
  });

  it('isSecureContext: true em localhost mesmo sem HTTPS', () => {
    setSecure(false, 'localhost');
    expect(service.isSecureContext()).toBe(true);
  });

  it('isSecureContext: false sem HTTPS e sem localhost', () => {
    setSecure(false, 'example.com');
    expect(service.isSecureContext()).toBe(false);
  });

  it('queryPermission: retorna state quando Permissions API existe', async () => {
    setPermissions('prompt');
    const res = await service.queryPermission();
    expect(res).toBe('prompt');
  });

  it('queryPermission: "unsupported" quando API não existe', async () => {
    setPermissions('unsupported');
    const res = await service.queryPermission();
    expect(res).toBe('unsupported');
  });

  // ---------------------------------------------------------
  // currentPosition$ (sucesso e erros)
  // ---------------------------------------------------------
  it('currentPosition$: emite coordenadas com geohash e completa', async () => {
    const pos = buildPosition({ latitude: -23.55, longitude: -46.63 });
    setGeolocationSuccess(pos);

    const result = await firstValueFrom(service.currentPosition$());
    expect(result.latitude).toBeCloseTo(-23.55, 6);
    expect(result.longitude).toBeCloseTo(-46.63, 6);
    expect(result.geohash).toBe('hash123456789');
    expect(geohashForLocation).toHaveBeenCalledWith([-23.55, -46.63]);
    expect(getCurrentPositionMock).toHaveBeenCalled();
  });

  async function expectCurrentPositionToFailWith(code: GeolocationErrorCode) {
    let err: unknown;
    try {
      await firstValueFrom(service.currentPosition$());
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(GeolocationError);
    expect((err as GeolocationError).code).toBe(code);
  }

  it('currentPosition$: mapeia erro do DOM 1 → PERMISSION_DENIED', async () => {
    setGeolocationError(1);
    await expectCurrentPositionToFailWith(GeolocationErrorCode.PERMISSION_DENIED);
  });

  it('currentPosition$: mapeia erro do DOM 2 → POSITION_UNAVAILABLE', async () => {
    setGeolocationError(2);
    await expectCurrentPositionToFailWith(GeolocationErrorCode.POSITION_UNAVAILABLE);
  });

  it('currentPosition$: mapeia erro do DOM 3 → TIMEOUT', async () => {
    setGeolocationError(3);
    await expectCurrentPositionToFailWith(GeolocationErrorCode.TIMEOUT);
  });

  it('currentPosition$: falha com USER_GESTURE_REQUIRED quando requireUserGesture=true e permissão não é "granted"', async () => {
    setPermissions('prompt'); // não concedida
    const pos = buildPosition();
    setGeolocationSuccess(pos);

    let err: unknown;
    try {
      await firstValueFrom(service.currentPosition$({ requireUserGesture: true }));
    } catch (e) {
      err = e;
    }
    expect((err as GeolocationError).code).toBe(GeolocationErrorCode.USER_GESTURE_REQUIRED);
    expect(getCurrentPositionMock).not.toHaveBeenCalled(); // travou no preflight
  });

  it('currentPosition$: falha com INSECURE_CONTEXT quando não é https e não é localhost', async () => {
    setSecure(false, 'example.com');
    let err: unknown;
    try {
      await firstValueFrom(service.currentPosition$());
    } catch (e) {
      err = e;
    }
    expect((err as GeolocationError).code).toBe(GeolocationErrorCode.INSECURE_CONTEXT);
  });

  // ---------------------------------------------------------
  // watchPosition$ (stream contínuo + cleanup)
  // ---------------------------------------------------------
  it('watchPosition$: emite atualizações e chama clearWatch no unsubscribe', fakeAsync(() => {
    const pos = buildPosition({ latitude: 1, longitude: 2 });
    setGeolocationSuccess(pos);

    const received: number[] = [];
    const sub = service.watchPosition$().pipe(take(2)).subscribe((v) => received.push(v.latitude));

    tick(0);  // resolve preflight
    tick(10); // 2 emissões

    expect(received.length).toBe(2);
    expect(received[0]).toBeCloseTo(1, 6);
    expect(received[1]).toBeCloseTo(1.001, 6);

    sub.unsubscribe();
    expect(clearWatchMock).toHaveBeenCalledWith(42);
  }));

  // ---------------------------------------------------------
  // Utilitários de privacidade + políticas
  // ---------------------------------------------------------
  it('toCoarseGeohash: fatia o geohash no comprimento solicitado', () => {
    expect(service.toCoarseGeohash('hash123456789', 5)).toBe('hash1');
    expect(service.toCoarseGeohash('abc', 9)).toBe('abc');
  });

  it('toCoarseCoords: arredonda lat/lon ao número de casas, com clamp 0..6', () => {
    const rounded = service.toCoarseCoords(
      { latitude: 12.3456789, longitude: -45.987654, geohash: undefined } as any,
      3
    );
    expect(rounded.latitude).toBe(12.346);
    expect(rounded.longitude).toBe(-45.988);

    const rounded6 = service.toCoarseCoords(
      { latitude: 12.3456789, longitude: -45.987654, geohash: undefined } as any,
      10
    );
    expect(rounded6.latitude).toBe(12.345679);
    expect(rounded6.longitude).toBe(-45.987654);
  });

  it('getPolicyFor: retorna política por role, caindo para free; reduzida se email não verificado', () => {
    const vip = service.getPolicyFor('vip', true);
    expect(vip).toEqual({ geohashLen: 9, maxDistanceKm: 100, decimals: 5 });

    const desconhecido = service.getPolicyFor('nao-existe', true);
    expect(desconhecido).toEqual({ geohashLen: 5, maxDistanceKm: 10, decimals: 2 });

    const reduzida = service.getPolicyFor('premium', false);
    expect(reduzida).toEqual({ geohashLen: 5, maxDistanceKm: 20, decimals: 2 });
  });

  it('applyRolePrivacy: aplica arredondamento e fatia do geohash conforme policy', () => {
    const coords = { latitude: -23.5566778, longitude: -46.6622333 } as any;
    const out = service.applyRolePrivacy(coords, 'premium', true);

    expect(out.coords.latitude).toBeCloseTo(-23.5567, 4);
    expect(out.coords.longitude).toBeCloseTo(-46.6622, 4);
    expect(out.geohash).toBe('hash1234'); // 8 chars
    expect(out.policy).toEqual({ geohashLen: 8, maxDistanceKm: 50, decimals: 4 });
  });

  // ---------------------------------------------------------
  // Compat (Promise)
  // ---------------------------------------------------------
  it('getCurrentLocation: resolve igual ao currentPosition$', async () => {
    const pos = buildPosition({ latitude: 9.9, longitude: 8.8 });
    setGeolocationSuccess(pos);

    const v = await service.getCurrentLocation();
    expect(v.latitude).toBeCloseTo(9.9, 6);
    expect(v.longitude).toBeCloseTo(8.8, 6);
    expect(v.geohash).toBe('hash123456789');
  });
});
