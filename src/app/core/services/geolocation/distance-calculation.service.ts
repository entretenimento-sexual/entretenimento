// src/app/core/services/distance-calculation.service.ts
import { Injectable } from '@angular/core';
import { distanceBetween } from 'geofire-common';

@Injectable({
  providedIn: 'root',
})
export class DistanceCalculationService {
  // Método para calcular a distância em metros entre duas localizações geográficas
  calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number | null {
    if (this.isValidCoordinates(lat1, lon1) && this.isValidCoordinates(lat2, lon2)) {
      const km = distanceBetween([lat1, lon1], [lat2, lon2]); // km
      return km * 1000; // ➜ metros
    }
    return null;
  }

  // Método para calcular distância em quilômetros e verificar se está dentro de um limite
  calculateDistanceInKm(
    lat1: number, lon1: number, lat2: number, lon2: number, maxDistanceKm?: number
  ): number | null {
    const meters = this.calculateDistance(lat1, lon1, lat2, lon2);
    if (meters === null) return null;

    const distanceInKm = Math.round((meters / 1000) * 100) / 100;
    if (typeof maxDistanceKm === 'number' && distanceInKm > maxDistanceKm) return null;
    return distanceInKm;
  }

  // Método auxiliar para verificar se as coordenadas são válidas
  private isValidCoordinates(latitude: number, longitude: number): boolean {
    return Number.isFinite(latitude) && Number.isFinite(longitude)
      && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
  }
}
