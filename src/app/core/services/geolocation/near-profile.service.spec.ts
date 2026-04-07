// src/app/core/services/geolocation/near-profile.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { describe, beforeAll, beforeEach, it, expect, vi, type Mock } from 'vitest';
import * as ffs from '@firebase/firestore';
import * as geofire from 'geofire-common';

import { NearbyProfilesService } from './near-profile.service';
import { DistanceCalculationService } from './distance-calculation.service';
import { Firestore } from '@angular/fire/firestore';

vi.mock('geofire-common', async () => {
  const original = await vi.importActual<typeof import('geofire-common')>('geofire-common');

  return {
    ...original,
    geohashQueryBounds: vi.fn((_center: [number, number], _radiusM: number) => [
      ['aaaa', 'zzzz'],
    ]),
  };
});

vi.mock('@firebase/firestore', async () => {
  const original =
    await vi.importActual<typeof import('@firebase/firestore')>('@firebase/firestore');

  return {
    ...original,
    collection: vi.fn(() => ({})),
    where: vi.fn(() => ({})),
    query: vi.fn(() => ({})),
    getDocs: vi.fn(),
    startAt: vi.fn(() => ({})),
    limit: vi.fn((_n: number) => ({})),
  };
});

const fsMock = ffs as unknown as {
  getDocs: Mock;
  query: Mock;
  where: Mock;
  collection: Mock;
  startAt: Mock;
  limit: Mock;
};

const geohashQueryBoundsMock = vi.mocked(geofire.geohashQueryBounds);

// ---- Stubs de dependências injetadas ---------------------------------------
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
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  beforeEach(() => {
    fsMock.getDocs.mockReset();
    fsMock.query.mockReset();
    fsMock.where.mockReset();
    fsMock.collection.mockReset();
    fsMock.startAt.mockReset();
    fsMock.limit.mockReset();

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

    fsMock.getDocs.mockResolvedValueOnce({ docs });

    const result = await service.getProfilesNearLocation(1, 1, 50, 'meu-uid');

    expect(geohashQueryBoundsMock).toHaveBeenCalledWith([1, 1], 50 * 1000);
    expect(fsMock.collection).toHaveBeenCalled();
    expect(result.length).toBe(1);
    expect(result[0].uid).toBe('A');
    expect(result[0].distanciaKm).toBe(5);
  });

  it('aplica startAfter quando startAfterDoc é informado', async () => {
    fsMock.getDocs.mockResolvedValueOnce({ docs: [] });
    const cursor = { id: 'cursor-doc' };

    await service.getProfilesNearLocation(1, 1, 50, 'meu-uid', cursor);

    expect(fsMock.startAt).toHaveBeenCalledTimes(1);
    expect(fsMock.limit).toHaveBeenCalledWith(50);
  });

  it('ignora documentos sem lat/lon numéricos', async () => {
    const docs = [
      makeDoc({ uid: 'A', latitude: 'x', longitude: 10 }),
      makeDoc({ uid: 'B', latitude: 10, longitude: undefined }),
    ];

    fsMock.getDocs.mockResolvedValueOnce({ docs });

    const result = await service.getProfilesNearLocation(1, 1, 50, 'meu-uid');

    expect(result).toEqual([]);
  });

  it('retorna array vazio em caso de erro de consulta', async () => {
    fsMock.getDocs.mockRejectedValueOnce(new Error('firestore down'));

    const result = await service.getProfilesNearLocation(1, 1, 50, 'meu-uid');

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});