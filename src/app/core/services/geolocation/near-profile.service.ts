// src\app\core\services\near-profile.service.ts
import { Injectable } from '@angular/core';
import { IUserDados } from '../../interfaces/iuser-dados';
import { collection, query, where, getDocs } from '@firebase/firestore';
import { FirestoreService } from '../autentication/firestore.service';
import { geohashQueryBounds, distanceBetween } from 'geofire-common';

@Injectable({
  providedIn: 'root'
})
export class NearbyProfilesService {
  constructor(private firestoreService: FirestoreService) { }

  async getProfilesNearLocation(latitude: number, longitude: number, maxDistanceKm: number): Promise<IUserDados[]> {
    try {
      const bounds = geohashQueryBounds([latitude, longitude], maxDistanceKm * 10000);
      const promises = bounds.map((b) => {
        const q = query(collection(this.firestoreService.db, 'users'),
          where('geohash', '>=', b[0]),
          where('geohash', '<=', b[1])
        );
        return getDocs(q);
      });

      const snapshots = await Promise.all(promises);
      const profiles: IUserDados[] = [];

      for (const snap of snapshots) {
        for (const doc of snap.docs) {
          const profile = doc.data() as IUserDados;
          if (typeof profile.latitude === 'number' && typeof profile.longitude === 'number') {
            const distance = distanceBetween([profile.latitude, profile.longitude], [latitude, longitude]);
            if (distance <= maxDistanceKm) {
              profiles.push(profile);
            }
          }
        }
      }

      return profiles;
    } catch (error) {
      console.error('Erro ao buscar perfis próximos:', error);
      // Retorne uma lista vazia em caso de erro
      return [];
    }
  }
}
