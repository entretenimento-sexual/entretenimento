// src/app/core/services/near-profile.service.ts
// Serviço para buscar perfis próximos usando geolocalização no Firestore
// Não esquecer os comentários
import { Injectable } from '@angular/core';
import { IUserDados } from '../../interfaces/iuser-dados';
import { collection, query, where, getDocs, startAt, limit } from '@firebase/firestore';
import { FirestoreService } from '../data-handling/legacy/firestore.service';
import { geohashQueryBounds } from 'geofire-common';
import { DistanceCalculationService } from './distance-calculation.service';

@Injectable({ providedIn: 'root' })
export class NearbyProfilesService {
  constructor(
    private firestoreService: FirestoreService,
    private distanceCalculationService: DistanceCalculationService
  ) { }

  async getProfilesNearLocation(
    latitude: number,
    longitude: number,
    maxDistanceKm: number,
    userUid: string,
    startAfterDoc?: any
  ): Promise<IUserDados[]> {
    const db = this.firestoreService.getFirestoreInstance();
    try {
      const bounds = geohashQueryBounds([latitude, longitude], maxDistanceKm * 1000);
      const promises = bounds.map((b) => {
        let q = query(
          collection(db, 'users'),
          where('geohash', '>=', b[0]),
          where('geohash', '<=', b[1]),
          limit(50)
        );
        if (startAfterDoc) q = query(q, startAt(startAfterDoc));
        return getDocs(q);
      });

      const snapshots = await Promise.all(promises);
      const profiles: IUserDados[] = [];

      for (const snap of snapshots) {
        for (const doc of snap.docs) {
          const profile = doc.data() as IUserDados;
          if (profile.uid !== userUid) {
            if (typeof profile.latitude === 'number' && typeof profile.longitude === 'number') {
              const distanceInKm = this.distanceCalculationService.calculateDistanceInKm(
                profile.latitude, profile.longitude, latitude, longitude, maxDistanceKm
              );
              if (distanceInKm !== null) {
                profile.distanciaKm = distanceInKm;
                profiles.push(profile);
              }
            }
          }
        }
      }

      return profiles;
    } catch (error) {
      console.log('Erro ao buscar perfis próximos:', error);
      return [];
    }
  }
}
