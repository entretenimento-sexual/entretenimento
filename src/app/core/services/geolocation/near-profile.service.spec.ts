import { TestBed } from '@angular/core/testing';

import { DistanceCalculationService } from './distance-calculation.service';
import { NearbyProfilesService } from './near-profile.service';
import { NearbyProfilesQueryGateway } from './nearby-profiles-query.gateway';

const queryGatewayMock = {
  fetchCandidates: vi.fn(),
};

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

    TestBed.configureTestingModule({
      providers: [
        NearbyProfilesService,
        { provide: NearbyProfilesQueryGateway, useValue: queryGatewayMock },
        {
          provide: DistanceCalculationService,
          useClass: DistanceCalculationServiceStub,
        },
      ],
    });

    service = TestBed.inject(NearbyProfilesService);
  });

  it('retorna perfis válidos e filtra o próprio usuário e perfis fora do raio', async () => {
    queryGatewayMock.fetchCandidates.mockResolvedValueOnce([
      { uid: 'meu-uid', latitude: 0, longitude: 0 },
      { uid: 'A', latitude: 10, longitude: 10 },
      { uid: 'B', latitude: 20, longitude: 20 },
    ]);

    const result = await service.getProfilesNearLocation(1, 1, 50, 'meu-uid');

    expect(queryGatewayMock.fetchCandidates).toHaveBeenCalledWith(
      1,
      1,
      50,
      undefined
    );
    expect(result).toHaveLength(1);
    expect(result[0].uid).toBe('A');
    expect(result[0].distanciaKm).toBe(5);
  });

  it('preserva o cursor startAfterDoc ao consultar os candidatos', async () => {
    queryGatewayMock.fetchCandidates.mockResolvedValueOnce([]);
    const cursor = { id: 'cursor-doc' };

    await service.getProfilesNearLocation(1, 1, 50, 'meu-uid', cursor);

    expect(queryGatewayMock.fetchCandidates).toHaveBeenCalledWith(
      1,
      1,
      50,
      cursor
    );
  });

  it('ignora documentos sem latitude ou longitude válidas', async () => {
    queryGatewayMock.fetchCandidates.mockResolvedValueOnce([
      { uid: 'A', latitude: 'x', longitude: 10 },
      { uid: 'B', latitude: 10, longitude: undefined },
    ]);

    const result = await service.getProfilesNearLocation(1, 1, 50, 'meu-uid');

    expect(result).toEqual([]);
  });

  it('retorna array vazio em caso de erro de consulta', async () => {
    queryGatewayMock.fetchCandidates.mockRejectedValueOnce(
      new Error('firestore down')
    );

    const result = await service.getProfilesNearLocation(1, 1, 50, 'meu-uid');

    expect(result).toEqual([]);
  });
});
