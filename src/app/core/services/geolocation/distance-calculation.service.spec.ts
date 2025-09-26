// src/app/core/services/distance-calculation.service.ts
import { TestBed } from '@angular/core/testing';
import { DistanceCalculationService } from '../geolocation/distance-calculation.service';

// mocka a lib externa para termos previsibilidade
jest.mock('geofire-common', () => ({
  distanceBetween: jest.fn(() => 1.234567), // km
}));

describe('DistanceCalculationService', () => {
  let service: DistanceCalculationService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DistanceCalculationService],
    });
    service = TestBed.inject(DistanceCalculationService);
  });

  it('calcula distância em metros quando coordenadas são válidas', () => {
    const m = service.calculateDistance(0, 0, 0.01, 0.01);
    // 1.234567 km => 1234.567 m
    expect(m).toBeCloseTo(1234.567, 3);
  });

  it('retorna null para coordenadas inválidas', () => {
    expect(service.calculateDistance(999, 0, 0, 0)).toBeNull();
    expect(service.calculateDistance(0, 0, 0, 181)).toBeNull();
  });

  it('calculateDistanceInKm arredonda para 2 casas e respeita maxDistanceKm', () => {
    const km = service.calculateDistanceInKm(0, 0, 0.01, 0.01);
    expect(km).toBeCloseTo(1.23, 2); // 1.234567 arredondado

    const limited = service.calculateDistanceInKm(0, 0, 0.01, 0.01, 1.0);
    expect(limited).toBeNull(); // 1.23 > 1.0
  });
});
