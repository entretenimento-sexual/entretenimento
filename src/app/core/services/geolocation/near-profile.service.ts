// src/app/core/services/geolocation/near-profile.service.ts
// -----------------------------------------------------------------------------
// NEARBY PROFILES SERVICE
// -----------------------------------------------------------------------------
// Busca perfis proximos por geohash e confirma a distancia real antes de emitir
// o resultado. O contrato Promise foi preservado para nao alterar os efeitos NgRx
// e os consumidores existentes nesta etapa.
// -----------------------------------------------------------------------------

import {
  EnvironmentInjector,
  Injectable,
  runInInjectionContext,
} from '@angular/core';
import {
  Firestore,
  collection,
  getDocs,
  limit,
  query,
  startAt,
  where,
} from '@angular/fire/firestore';
import { geohashQueryBounds } from 'geofire-common';

import { IUserDados } from '../../interfaces/iuser-dados';
import { DistanceCalculationService } from './distance-calculation.service';
import {
  extractValidGeoCoordinates,
  isValidGeoCoordinatePair,
} from './utils/geolocation-coordinate.utils';

@Injectable({ providedIn: 'root' })
export class NearbyProfilesService {
  constructor(
    private readonly db: Firestore,
    private readonly distanceCalculationService: DistanceCalculationService,
    private readonly environmentInjector: EnvironmentInjector
  ) {}

  async getProfilesNearLocation(
    latitude: number,
    longitude: number,
    maxDistanceKm: number,
    userUid: string,
    startAfterDoc?: unknown
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
      const bounds = geohashQueryBounds(
        [latitude, longitude],
        safeMaxDistanceKm * 1000
      );

      const snapshots = await Promise.all(
        bounds.map((bound) =>
          runInInjectionContext(this.environmentInjector, () => {
            let nearbyProfilesQuery = query(
              collection(this.db, 'users'),
              where('geohash', '>=', bound[0]),
              where('geohash', '<=', bound[1]),
              limit(50)
            );

            // A nomenclatura legada startAfterDoc foi preservada. A consulta
            // existente usa startAt; alterar a semantica exigiria migrar todos os
            // consumidores e cursores em uma etapa separada.
            if (startAfterDoc) {
              nearbyProfilesQuery = query(
                nearbyProfilesQuery,
                startAt(startAfterDoc)
              );
            }

            return getDocs(nearbyProfilesQuery);
          })
        )
      );
      const profiles: IUserDados[] = [];

      for (const snapshot of snapshots) {
        for (const documentSnapshot of snapshot.docs) {
          const profile = documentSnapshot.data() as IUserDados;

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
      }

      return profiles;
    } catch (error) {
      // O comportamento tolerante existente e preservado para nao interromper a
      // descoberta quando uma consulta geografica falha.
      // eslint-disable-next-line no-console
      console.log('Erro ao buscar perfis próximos:', error);
      return [];
    }
  }
}
