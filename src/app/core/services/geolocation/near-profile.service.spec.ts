import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';

const { firestoreMocks, geofireMocks } = vi.hoisted(() => ({
  firestoreMocks: {
    collection: vi.fn(() => ({})),
    where: vi.fn(() => ({})),
    query: vi.fn(() => ({})),
    getDocs: vi.fn(),
    startAt: vi.fn(() => ({})),
    limit: vi.fn((_value: number) => ({})),
  },
  geofireMocks: {
    geohashQueryBounds: vi.fn(
      (_center: [number, number], _radiusM: number) => [
        ['aaaa', 'zzzz'],
      ]
    ),
  },
}));

vi.mock('@firebase/firestore', () => firestoreMocks);
vi.mock('geofire-common', () => geofireMocks);

import { DistanceCalculationService } from './distance-calculation.service';
import { NearbyProfilesService } from './near-profile.service';

class DistanceCalculationServiceStub {
  calculateDistanceInKm = vi.fn(
    (
      latitude: number,
      _longitude: number,
      _originLatitude: number,
      _originLongitude: number,
      _maximumDistanceKm?: number
    ) => {
      if (latitude === 10) return 5;
      if (latitude === 20) return null;
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
    TestBed.resetTestingModule();
    vi.clearAllMocks();

    firestoreMocks.collection.mockReturnValue({});
    firestoreMocks.where.mockReturnValue({});
    firestoreMocks.query.mockReturnValue({});
    firestoreMocks.startAt.mockReturnValue({});
    firestoreMocks.limit.mockReturnValue({});
    geofireMocks.geohashQueryBounds.mockReturnValue([
      ['aaaa', 'zzzz'],
    ]);

    TestBed.configureTestingModule({
      providers: [
        NearbyProfilesService,
        { provide: Firestore, useValue: {} },
        {
          provide: DistanceCalculationService,
          useClass: DistanceCalculationServiceStub,
        },
      ],
    });

    service = TestBed.inject(NearbyProfilesService);
  });

  function makeDoc(data: unknown) {
    return { data: () => data };
  }

  it('retorna perfis válidos e filtra o próprio usuário e perfis fora do raio', async () => {
    firestoreMocks.getDocs.mockResolvedValueOnce({
      docs: [
        makeDoc({ uid: 'meu-uid', latitude: 0, longitude: 0 }),
        makeDoc({ uid: 'A', latitude: 10, longitude: 10 }),
        makeDoc({ uid: 'B', latitude: 20, longitude: 20 }),
      ],
    });

    const result = await service.getProfilesNearLocation(1, 1, 50, 'meu-uid');

    expect(geofireMocks.geohashQueryBounds).toHaveBeenCalledWith(
      [1, 1],
      50 * 1000
    );
    expect(firestoreMocks.collection).toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result[0].uid).toBe('A');
    expect(result[0].distanciaKm).toBe(5);
  });

  it('aplica startAt quando startAfterDoc é informado', async () => {
    firestoreMocks.getDocs.mockResolvedValueOnce({ docs: [] });
    const cursor = { id: 'cursor-doc' };

    await service.getProfilesNearLocation(1, 1, 50, 'meu-uid', cursor);

    expect(firestoreMocks.startAt).toHaveBeenCalledOnce();
    expect(firestoreMocks.limit).toHaveBeenCalledWith(50);
  });

  it('ignora documentos sem latitude ou longitude válidas', async () => {
    firestoreMocks.getDocs.mockResolvedValueOnce({
      docs: [
        makeDoc({ uid: 'A', latitude: 'x', longitude: 10 }),
        makeDoc({ uid: 'B', latitude: 10, longitude: undefined }),
      ],
    });

    const result = await service.getProfilesNearLocation(1, 1, 50, 'meu-uid');

    expect(result).toEqual([]);
  });

  it('retorna array vazio em caso de erro de consulta', async () => {
    firestoreMocks.getDocs.mockRejectedValueOnce(new Error('firestore down'));

    const result = await service.getProfilesNearLocation(1, 1, 50, 'meu-uid');

    expect(result).toEqual([]);
  });
});
