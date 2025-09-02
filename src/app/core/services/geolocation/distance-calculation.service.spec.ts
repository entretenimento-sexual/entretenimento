// src/app/core/services/geolocation/distance-calculation.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { DistanceCalculationService } from './distance-calculation.service';

describe('DistanceCalculationService', () => {
  let service: DistanceCalculationService;

  beforeAll(() => {
    // silencia logs deste arquivo (seu setup-jest já cobre globalmente, mas deixo garantido)
    jest.spyOn(console, 'log').mockImplementation(() => { });
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DistanceCalculationService],
    });
    service = TestBed.inject(DistanceCalculationService);
  });

  it('calcula distância em metros entre dois pontos válidos', () => {
    // (0,0) -> (0,1) ~ 111 km na linha do Equador
    const d = service.calculateDistance(0, 0, 0, 1);
    expect(typeof d).toBe('number');
    expect(d!).toBeGreaterThan(100_000);
    expect(d!).toBeLessThan(120_000);
  });

  it('retorna null para coordenadas inválidas', () => {
    expect(service.calculateDistance(95, 0, 0, 0)).toBeNull();
    expect(service.calculateDistance(0, 190, 0, 0)).toBeNull();
  });

  it('calculateDistanceInKm retorna valor arredondado quando dentro do limite', () => {
    // ~111 km → limite 200 km → mantém
    const km = service.calculateDistanceInKm(0, 0, 0, 1, 200);
    expect(km).not.toBeNull();
    expect(km!).toBeGreaterThan(100);
    expect(km!).toBeLessThan(120);
  });

  it('calculateDistanceInKm retorna null quando fora do limite', () => {
    // ~111 km → limite 50 km → filtra
    const km = service.calculateDistanceInKm(0, 0, 0, 1, 50);
    expect(km).toBeNull();
  });
});
