// src/app/core/services/geolocation/near-profile.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { NearbyProfilesService } from './near-profile.service';
import { DistanceCalculationService } from './distance-calculation.service';
import { FirestoreService } from '../data-handling/firestore.service';

// ⛳️ usamos o mock global de @firebase/firestore definido no setup-jest,
// mas este arquivo garante que existam as funções startAt/limit que o serviço usa.
const fsMock = jest.requireMock('@firebase/firestore') as any;
if (!fsMock.startAt) fsMock.startAt = jest.fn(() => ({}));
if (!fsMock.limit) fsMock.limit = jest.fn((_n: number) => ({}));

// Mock do geofire-common apenas para geohashQueryBounds
jest.mock('geofire-common', () => {
  const original = jest.requireActual('geofire-common');
  return {
    ...original,
    geohashQueryBounds: jest.fn((_center: [number, number], _radiusM: number) => [
      ['aaaa', 'zzzz'], // um único bound simplificado
    ]),
  };
});
const { geohashQueryBounds } = jest.requireMock('geofire-common');

// ---- Stubs de dependências injetadas ---------------------------------------
class FirestoreServiceStub {
  getFirestoreInstance() {
    return {}; // o mock de @firebase/firestore ignora este valor
  }
}

class DistanceCalculationServiceStub {
  // decide quem entra na resposta
  calculateDistanceInKm = jest.fn(
    (lat1: number, lon1: number, lat2: number, lon2: number, maxKm?: number) => {
      // se o doc tiver latitude 10 devolvemos 5km, se 20 devolvemos null (fora do raio),
      // qualquer outro número devolve 1km
      if (lat1 === 10) return 5;
      if (lat1 === 20) return null;
      return 1;
    }
  );
}

describe('NearbyProfilesService', () => {
  let service: NearbyProfilesService;

  beforeAll(() => {
    jest.spyOn(console, 'log').mockImplementation(() => { });
  });

  beforeEach(() => {
    // zera mocks do módulo firestore entre testes
    fsMock.getDocs?.mockReset?.();
    fsMock.query?.mockReset?.();
    fsMock.where?.mockReset?.();
    fsMock.collection?.mockReset?.();
    fsMock.startAt?.mockReset?.();
    fsMock.limit?.mockReset?.();

    TestBed.configureTestingModule({
      providers: [
        NearbyProfilesService,
        { provide: FirestoreService, useClass: FirestoreServiceStub },
        { provide: DistanceCalculationService, useClass: DistanceCalculationServiceStub },
      ],
    });
    service = TestBed.inject(NearbyProfilesService);
  });

  function makeDoc(data: any) {
    return { data: () => data };
  }

  it('retorna perfis válidos (filtra próprio usuário e fora do raio)', async () => {
    // prepara docs: um é do próprio usuário, outro dentro do raio, outro fora do raio
    const docs = [
      makeDoc({ uid: 'meu-uid', latitude: 0, longitude: 0 }), // deve ser filtrado
      makeDoc({ uid: 'A', latitude: 10, longitude: 10 }),     // entra (5km)
      makeDoc({ uid: 'B', latitude: 20, longitude: 20 }),     // fora do raio (null)
    ];

    fsMock.getDocs.mockResolvedValueOnce({ docs });

    const result = await service.getProfilesNearLocation(1, 1, 50, 'meu-uid');

    expect(geohashQueryBounds).toHaveBeenCalledWith([1, 1], 50 * 1000);
    expect(fsMock.collection).toHaveBeenCalled(); // consulta feita
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

    expect(result).toEqual([]); // nenhum entra
  });

  it('retorna array vazio em caso de erro de consulta', async () => {
    fsMock.getDocs.mockRejectedValueOnce(new Error('firestore down'));

    const result = await service.getProfilesNearLocation(1, 1, 50, 'meu-uid');

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(0);
  });
});
