// src/app/core/services/geolocation/distance-calculation.service.ts
// -----------------------------------------------------------------------------
// DistanceCalculationService
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - calcular distância entre coordenadas geográficas;
// - retornar null quando as coordenadas forem inválidas;
// - manter a regra de validação centralizada em geolocation-coordinate.utils.ts.
//
// Observação:
// - este service não consulta navegador;
// - não persiste dados;
// - não decide regra de privacidade;
// - apenas calcula distância.

import { Injectable } from '@angular/core';
import { distanceBetween } from 'geofire-common';

import { isValidGeoCoordinatePair } from './utils/geolocation-coordinate.utils';

@Injectable({
  providedIn: 'root',
})
export class DistanceCalculationService {
  /**
   * Calcula a distância em metros entre duas localizações geográficas.
   */
  calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ): number | null {
    if (
      !isValidGeoCoordinatePair(lat1, lon1) ||
      !isValidGeoCoordinatePair(lat2, lon2)
    ) {
      return null;
    }

    const km = distanceBetween([lat1, lon1], [lat2, lon2]);

    return km * 1000;
  }

  /**
   * Calcula distância em quilômetros.
   *
   * Se maxDistanceKm for informado e a distância ultrapassar o limite,
   * retorna null. Isso preserva o comportamento atual usado por perfis próximos.
   */
  calculateDistanceInKm(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
    maxDistanceKm?: number
  ): number | null {
    const meters = this.calculateDistance(lat1, lon1, lat2, lon2);

    if (meters === null) {
      return null;
    }

    const distanceInKm = Math.round((meters / 1000) * 100) / 100;

    if (
      typeof maxDistanceKm === 'number' &&
      Number.isFinite(maxDistanceKm) &&
      distanceInKm > maxDistanceKm
    ) {
      return null;
    }

    return distanceInKm;
  }
}