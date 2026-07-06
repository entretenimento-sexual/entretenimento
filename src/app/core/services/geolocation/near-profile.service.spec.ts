// src/app/core/services/geolocation/near-profile.service.spec.ts
import { describe, beforeAll, beforeEach, it, expect, vi } from 'vitest';

const firestoreMocks = vi.hoisted(() => ({
  collection: vi.fn(() => ({})),
  where: vi.fn(() => ({})),
  query: vi.fn(() => ({})),
  getDocs: vi.fn(),
  startAt: vi.fn(() => ({})),
  limit: vi.fn((_n: number) => ({})),
}));

const geofireMocks = vi.hoisted(() => ({
  geohashQueryBounds: vi.fn((_center: [number, number], _radiusM: number) => [
    ['aaaa', 'zzzz'],
  ]),
  distanceBetween: vi.fn((from: [number, number], to: [number, number]) => {
    const [lat1, lon1] = from;
    const [lat2, lon2] = to;
    const toRadians = (value: number) => value * Math.PI / 180;
    const earthRadiusKm = 6371;
    const deltaLat = toRadians(lat2 - lat1);
    const deltaLon = toRadians(lon2 - lon1);
    const a = Math.sin(deltaLat / 2) ** 2
      + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2))
      * Math.sin(deltaLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return earthRadiusKm * c;
  }),
}));

vi.mock('@firebase/firestore', () => firestoreMocks);
vi.mock('geofire-common', () => geofireMocks);

import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { NearbyProfilesService } from './near-profile.service';
import { DistanceCalculationService } from './distance-calculation.service';

class DistanceCalculationServiceStub {
  calculateDistanceInKm = vi.fn(
    (lat1: number, _lon1: number, _lat2: number, _lon2: number, _maxKm?: number) => {
      if (lat1 === 10) return 5;
      if (lat1 === 20) return null;
      return 1;
    }
  );
}

describe('NearbyProfilesService', () => {
  let service: NearbyProfilesService;

  beforeAll(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  beforeEach(() => {
    firestoreMocks.getDocs.mockReset();
    firestoreMocks.query.mockReset();
    firestoreMocks.where.mockReset();
    firestoreMocks.collection.mockReset();
    firestoreMocks.startAt.mockReset();
    firestoreMocks.limit.mockReset();
    geofireMocks.geohashQueryBounds.mockClear();
    geofireMocks.distanceBetween.mockClear();

    firestoreMocks.collection.mockReturnValue({});
    firestoreMocks.where.mockReturnValue({});
    firestoreMocks.query.mockReturnValue({});
    firestoreMocks.startAt.mockReturnValue({});
    firestoreMocks.limit.mockReturnValue({});

    TestBed.configureTestingModule({
      providers: [
        NearbyProfilesService,
        { provide: Firestore, useValue: {} as Firestore },
        { provide: DistanceCalculationService, useClass: DistanceCalculationServiceStub },
      ],
    });

    service = TestBed.inject(NearbyProfilesService);
  });

  function makeDoc(data: any) {
    return { data: () => data };
  }

  it('retorna perfis válidos (filtra próprio usuário e fora do raio)', async () => {
    const docs = [
      makeDoc({ uid: 'meu-uid', latitude: 0, longitude: 0 }),
      makeDoc({ uid: 'A', latitude: 10, longitude: 10 }),
      makeDoc({ uid: 'B', latitude: 20, longitude: 20 }),
    ];

    firestoreMocks.getDocs.mockResolvedValueOnce({ docs });

    const result = await service.getProfilesNearLocation(1, 1, 50, 'meu-uid');

    expect(geofireMocks.geohashQueryBounds).toHaveBeenCalledWith([1, 1], 50 * 1000);
    expect(firestoreMocks.collection).toHaveBeenCalled();
    expect(result.length).toBe(1);
    expect(result[0].uid).toBe('A');
    expect(result[0].distanciaKm).toBe(5);
  });

  it('aplica startAt quando startAfterDoc é informado', async () => {
    firestoreMocks.getDocs.mockResolvedValueOnce({ docs: [] });
    const cursor = { id: 'cursor-doc' };

    await service.getProfilesNearLocation(1, 1, 50, 'meu-uid', cursor);

    expect(firestoreMocks.startAt).toHaveBeenCalledTimes(1);
    expect(firestoreMocks.limit).toHaveBeenCalledWith(50);
  });

  it('ignora documentos sem lat/lon numéricos', async () => {
    const docs = [
      makeDoc({ uid: 'A', latitude: 'x', longitude: 10 }),
      makeDoc({ uid: 'B', latitude: 10, longitude: undefined }),
    ];

    firestoreMocks.getDocs.mockResolvedValueOnce({ docs });

    const result = await service.getProfilesNearLocation(1, 1, 50, 'meu-uid');

    expect(result).toEqual([]);
  });

  it('retorna array vazio em caso de erro de consulta', async () => {
    firestoreMocks.getDocs.mockRejectedValueOnce(new Error('firestore down'));

    const result = await service.getProfilesNearLocation(1, 1, 50, 'meu-uid');

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});
