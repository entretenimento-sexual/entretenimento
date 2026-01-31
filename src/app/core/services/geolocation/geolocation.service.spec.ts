// src/app/core/services/geolocation/geolocation.service.spec.ts
import { TestBed } from '@angular/core/testing';
import {
  GeolocationService,
  GeolocationError,
  GeolocationErrorCode,
  type GeoPolicy,
} from './geolocation.service';
import { of } from 'rxjs';
import type { GeoCoordinates } from '../../interfaces/geolocation.interface';

describe('GeolocationService', () => {
  let service: GeolocationService;

  // backups
  const origIsSecure = (window as any).isSecureContext;
  const origLocation = window.location;
  const origNavigator: any = { ...navigator };

  let clearCalled = false;

  const geoMock = {
    getCurrentPosition: (success: PositionCallback) => {
      success({
        coords: {
          latitude: 1,
          longitude: 0,
          accuracy: 0,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        } as any,
        timestamp: Date.now(),
      } as GeolocationPosition);
    },
    watchPosition: (success: PositionCallback) => {
      // emite 2 posições SINCRONAMENTE (evita fake timers / tick)
      success({
        coords: {
          latitude: 1,
          longitude: 0,
          accuracy: 0,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        } as any,
        timestamp: Date.now(),
      } as GeolocationPosition);
      success({
        coords: {
          latitude: 1.001,
          longitude: 0,
          accuracy: 0,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        } as any,
        timestamp: Date.now(),
      } as GeolocationPosition);
      return 42 as unknown as number;
    },
    clearWatch: (_id: number) => {
      clearCalled = true;
    },
  } as unknown as Geolocation;

  function setPermissions(state: PermissionState | 'unsupported') {
    const permissions: any =
      state === 'unsupported'
        ? {}
        : { query: () => Promise.resolve({ state }) };
    (navigator as any).permissions = permissions;
  }

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [GeolocationService],
    });
    service = TestBed.inject(GeolocationService);

    (window as any).isSecureContext = true;

    Object.defineProperty(navigator, 'geolocation', {
      value: geoMock,
      configurable: true,
      writable: true,
    });

    setPermissions('granted');
    clearCalled = false;
  });

  afterAll(() => {
    (window as any).isSecureContext = origIsSecure;
    Object.defineProperty(window, 'location', { value: origLocation });
    Object.defineProperty(navigator, 'geolocation', {
      value: origNavigator.geolocation,
      configurable: true,
      writable: true,
    });
    (navigator as any).permissions = origNavigator.permissions;
  });

  it('deve ser criado', () => {
    expect(service).toBeTruthy();
  });

  describe('isSupported / isSecureContext', () => {
    it('isSupported() retorna true quando navigator.geolocation existe', () => {
      expect(service.isSupported()).toBe(true);
    });

    it('isSecureContext() respeita window.isSecureContext/hostname', () => {
      (window as any).isSecureContext = true;
      Object.defineProperty(window, 'location', { value: { hostname: 'example.com' } as any });
      expect(service.isSecureContext()).toBe(true);

      (window as any).isSecureContext = false;
      Object.defineProperty(window, 'location', { value: { hostname: 'localhost' } as any });
      expect(service.isSecureContext()).toBe(true);

      (window as any).isSecureContext = false;
      Object.defineProperty(window, 'location', { value: { hostname: 'example.com' } as any });
      expect(service.isSecureContext()).toBe(false);
    });
  });

  describe('queryPermission()', () => {
    it('retorna estado quando Permissions API disponível', async () => {
      setPermissions('granted');
      const state = await service.queryPermission();
      expect(state).toBe('granted');
    });

    it('retorna "unsupported" quando Permissions API ausente', async () => {
      setPermissions('unsupported');
      const state2 = await service.queryPermission();
      expect(state2).toBe('unsupported');
    });
  });

  describe('currentPosition$', () => {
    it('emite coordenadas e completa (sucesso)', (done) => {
      service.currentPosition$().subscribe({
        next: (coords) => {
          expect(coords.latitude).toBeCloseTo(1, 6);
          expect(coords.longitude).toBeCloseTo(0, 6);
          expect(typeof coords.geohash).toBe('string');
          expect((coords.geohash || '').length).toBeGreaterThan(0);
        },
        complete: () => done(),
        error: done.fail,
      });
    });

    it('mapeia erro DOM → GeolocationError (PERMISSION_DENIED)', (done) => {
      const errGeo = { code: 1 } as GeolocationPositionError;
      (navigator.geolocation as any).getCurrentPosition = (_s: any, e: any) => e(errGeo);

      service.currentPosition$().subscribe({
        next: () => done.fail('não deveria emitir sucesso'),
        error: (err: unknown) => {
          expect(err instanceof GeolocationError).toBe(true);
          expect((err as GeolocationError).code).toBe(GeolocationErrorCode.PERMISSION_DENIED);
          done();
        },
      });
    });

    it('requireUserGesture:true + permissão != granted → USER_GESTURE_REQUIRED e NÃO chama geolocation', (done) => {
      setPermissions('prompt'); // não é granted

      let called = false;
      (navigator.geolocation as any).getCurrentPosition = () => { called = true; };

      service.currentPosition$({ requireUserGesture: true }).subscribe({
        next: () => done.fail('não deveria emitir sucesso'),
        error: (err: GeolocationError) => {
          expect(called).toBe(false);
          expect(err.code).toBe(GeolocationErrorCode.USER_GESTURE_REQUIRED);
          done();
        },
      });
    });
  });

  describe('watchPosition$', () => {
    it('emite atualizações (2 chamadas síncronas) e chama clearWatch no unsubscribe', (done) => {
      const received: number[] = [];

      const sub = service.watchPosition$().subscribe({
        next: (coords) => received.push(coords.latitude),
        error: done.fail,
      });

      setTimeout(() => {
        expect(received.length).toBe(2);
        expect(received[0]).toBeCloseTo(1, 6);
        expect(received[1]).toBeCloseTo(1.001, 6);
        sub.unsubscribe();
        expect(clearCalled).toBe(true);
        done();
      }, 0);
    });

    it('mapeia erro do DOM em erro tipado (TIMEOUT)', (done) => {
      (navigator.geolocation as any).watchPosition = (_success: any, error: any) => {
        setTimeout(() => error({ code: 3 }), 0);
        return 7;
      };

      service.watchPosition$().subscribe({
        next: () => done.fail('não deveria emitir sucesso'),
        error: (err: GeolocationError) => {
          expect(err.code).toBe(GeolocationErrorCode.TIMEOUT);
          done();
        },
      });
    });
  });

  describe('privacidade / utilitários', () => {
    it('toCoarseGeohash reduz para o tamanho solicitado (mín 1, máx geohash.length)', () => {
      const g = 'u4pruydqqvj';
      expect(service.toCoarseGeohash(g, 3)).toBe('u4p');
      expect(service.toCoarseGeohash(g, 50)).toBe(g);
      expect(service.toCoarseGeohash(undefined as any, 5)).toBeUndefined();
    });

    it('toCoarseCoords arredonda latitude/longitude e respeita clamp de casas', () => {
      const coords: GeoCoordinates = {
        latitude: 12.3456789,
        longitude: -98.7654321,
        accuracy: 5,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        geohash: undefined,
      };
      const out = service.toCoarseCoords(coords, 9);
      expect(out.latitude).toBeCloseTo(12.345679, 6);
      expect(out.longitude).toBeCloseTo(-98.765432, 6);

      const out2 = service.toCoarseCoords(coords, 2);
      expect(out2.latitude).toBeCloseTo(12.35, 2);
      expect(out2.longitude).toBeCloseTo(-98.77, 2);
    });

    it('getPolicyFor retorna política por role e aplica downgrade quando email não verificado', () => {
      const vip = service.getPolicyFor('vip', true);
      expect(vip).toEqual({ geohashLen: 9, maxDistanceKm: 100, decimals: 5 } as GeoPolicy);

      const basicoUnverified = service.getPolicyFor('basic', false);
      expect(basicoUnverified.geohashLen).toBeLessThanOrEqual(5);
      expect(basicoUnverified.maxDistanceKm).toBeLessThanOrEqual(20);
      expect(basicoUnverified.decimals).toBeLessThanOrEqual(2);
    });

    it('applyRolePrivacy reduz precisão de coords e do geohash conforme a policy', () => {
      const coords: GeoCoordinates = {
        latitude: -23.55052,
        longitude: -46.633308,
        accuracy: 5,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        geohash: undefined,
      };

      const { coords: coarse, geohash, policy } = service.applyRolePrivacy(coords, 'free', true);

      expect(typeof geohash).toBe('string');
      expect((geohash || '').length).toBe(policy.geohashLen);
      expect(Number.isFinite(coarse.latitude)).toBe(true);
      expect(Number.isFinite(coarse.longitude)).toBe(true);
      expect(coarse.latitude).toBeCloseTo(-23.55, 2);
      expect(coarse.longitude).toBeCloseTo(-46.63, 2);
    });
  });

  describe('getCurrentLocation (legacy)', () => {
    it('resolve com a posição atual (wrap de currentPosition$)', async () => {
      const fake: GeoCoordinates = {
        latitude: 1,
        longitude: 0,
        accuracy: 0,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null,
        geohash: 'abc',
      };

      // evita depender do preflight/DOM aqui; testamos apenas o wrap
      jest.spyOn(service, 'currentPosition$').mockReturnValue(of(fake));

      const got = await service.getCurrentLocation();
      expect(got.latitude).toBeCloseTo(1, 6);
      expect(got.longitude).toBeCloseTo(0, 6);
    });
  });
})
