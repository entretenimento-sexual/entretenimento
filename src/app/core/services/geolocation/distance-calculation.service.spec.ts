// src/app/core/services/geolocation/distance-calculation.service.spec.ts
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';

import { DistanceCalculationService } from './distance-calculation.service';

describe('DistanceCalculationService', () => {
  let service: DistanceCalculationService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DistanceCalculationService],
    });
    service = TestBed.inject(DistanceCalculationService);
  });

  it('calcula distância em metros quando coordenadas são válidas', () => {
    const meters = service.calculateDistance(0, 0, 0.01, 0.01);

    expect(meters).toBeCloseTo(1572.534, 3);
  });

  it('retorna null para coordenadas inválidas', () => {
    expect(service.calculateDistance(999, 0, 0, 0)).toBeNull();
    expect(service.calculateDistance(0, 0, 0, 181)).toBeNull();
  });

  it('calculateDistanceInKm arredonda para 2 casas e respeita maxDistanceKm', () => {
    const km = service.calculateDistanceInKm(0, 0, 0.01, 0.01);
    expect(km).toBeCloseTo(1.57, 2);

    const limited = service.calculateDistanceInKm(0, 0, 0.01, 0.01, 1.0);
    expect(limited).toBeNull();
  });
});
