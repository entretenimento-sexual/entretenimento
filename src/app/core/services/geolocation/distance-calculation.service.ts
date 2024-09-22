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
      return distanceBetween([lat1, lon1], [lat2, lon2]);
    }
    return null; // Se as coordenadas forem inválidas, retorna null
  }

  // Método para calcular distância em quilômetros e verificar se está dentro de um limite
  calculateDistanceInKm(lat1: number, lon1: number, lat2: number, lon2: number, maxDistanceKm?: number): number | null {
    const distance = this.calculateDistance(lat1, lon1, lat2, lon2);
    if (distance !== null) {
      const distanceInKm = Math.round((distance / 1000) * 100) / 100; // Converte metros para km e arredonda
      console.log(`Distância calculada: ${distanceInKm} km entre (${lat1}, ${lon1}) e (${lat2}, ${lon2})`);

      if (maxDistanceKm && distanceInKm > maxDistanceKm) {
        console.log(`Distância maior que o limite máximo de ${maxDistanceKm} km.`);
        return null; // Retorna null se a distância for maior que o limite
      }
      return distanceInKm;
    } else {
      console.log(`Coordenadas inválidas ou erro ao calcular a distância.`);
    }
    return null;
  }

  // Método auxiliar para verificar se as coordenadas são válidas
  private isValidCoordinates(latitude: number, longitude: number): boolean {
    return (
      typeof latitude === 'number' &&
      typeof longitude === 'number' &&
      latitude >= -90 &&
      latitude <= 90 &&
      longitude >= -180 &&
      longitude <= 180
    );
  }
}
