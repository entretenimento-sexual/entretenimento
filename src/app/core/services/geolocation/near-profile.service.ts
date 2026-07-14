import { Injectable } from '@angular/core';

import { IUserDados } from '../../interfaces/iuser-dados';
import { DistanceCalculationService } from './distance-calculation.service';
import { NearbyProfilesQueryGateway } from './nearby-profiles-query.gateway';
import {
  extractValidGeoCoordinates,
  isValidGeoCoordinatePair,
} from './utils/geolocation-coordinate.utils';

@Injectable({ providedIn: 'root' })
export class NearbyProfilesService {
  constructor(
    private readonly distanceCalculationService: DistanceCalculationService,
    private readonly queryGateway: NearbyProfilesQueryGateway
  ) {}

  async getProfilesNearLocation(
    latitude: number,
    longitude: number,
    maxDistanceKm: number,
    userUid: string,
    startAfterDoc?: any
  ): Promise<IUserDados[]> {
    try {
      if (!isValidGeoCoordinatePair(latitude, longitude)) {
        return [];
      }

      const safeMaxDistanceKm =
        typeof maxDistanceKm === 'number' && Number.isFinite(maxDistanceKm)
          ? Math.max(1, maxDistanceKm)
          : 20;
      const safeUserUid = String(userUid ?? '').trim();
      const candidates = await this.queryGateway.fetchCandidates(
        latitude,
        longitude,
        safeMaxDistanceKm,
        startAfterDoc
      );
      const profiles: IUserDados[] = [];

      for (const profile of candidates) {
        if (profile.uid === safeUserUid) {
          continue;
        }

        const profileCoordinates = extractValidGeoCoordinates(profile);

        if (!profileCoordinates) {
          continue;
        }

        const distanceInKm =
          this.distanceCalculationService.calculateDistanceInKm(
            profileCoordinates.latitude,
            profileCoordinates.longitude,
            latitude,
            longitude,
            safeMaxDistanceKm
          );

        if (distanceInKm !== null) {
          profiles.push({
            ...profile,
            latitude: profileCoordinates.latitude,
            longitude: profileCoordinates.longitude,
            distanciaKm: distanceInKm,
          });
        }
      }

      return profiles;
    } catch (error) {
      // Mantém o contrato atual: falhas de consulta não interrompem a descoberta.
      // eslint-disable-next-line no-console
      console.log('Erro ao buscar perfis próximos:', error);
      return [];
    }
  }
}
