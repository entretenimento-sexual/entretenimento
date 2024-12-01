// src/app/core/services/near-profile.service.ts
import { Injectable } from '@angular/core';
import { IUserDados } from '../../interfaces/iuser-dados';
import { collection, query, where, getDocs, startAt, limit } from '@firebase/firestore';
import { FirestoreService } from '../data-handling/firestore.service';
import { geohashQueryBounds } from 'geofire-common';
import { DistanceCalculationService } from './distance-calculation.service';

@Injectable({
  providedIn: 'root'
})
export class NearbyProfilesService {
  constructor(
    private firestoreService: FirestoreService,
    private distanceCalculationService: DistanceCalculationService // Injetar o serviço de cálculo de distância
  ) { }

  async getProfilesNearLocation(latitude: number, longitude: number, maxDistanceKm: number, userUid: string, startAfterDoc?: any): Promise<IUserDados[]> {
    try {
      const bounds = geohashQueryBounds([latitude, longitude], maxDistanceKm * 1000); // ajuste para converter km para metros
      const promises = bounds.map((b) => {
        let q = query(
          collection(this.firestoreService.db, 'users'),
          where('geohash', '>=', b[0]),
          where('geohash', '<=', b[1]),
          limit(50) // Limita a 50 perfis
        );

        if (startAfterDoc) {
          q = query(q, startAt(startAfterDoc));
        }

        return getDocs(q);
      });

      const snapshots = await Promise.all(promises);
      const profiles: IUserDados[] = [];

      for (const snap of snapshots) {
        for (const doc of snap.docs) {
          const profile = doc.data() as IUserDados;
          if (profile.uid !== userUid) {  // Filtra o perfil do usuário logado
            if (typeof profile.latitude === 'number' && typeof profile.longitude === 'number') {
              // Delegar o cálculo de distância ao serviço de cálculo
              const distanceInKm = this.distanceCalculationService.calculateDistanceInKm(
                profile.latitude,
                profile.longitude,
                latitude,
                longitude,
                maxDistanceKm
              );

              if (distanceInKm !== null) {  // Apenas adiciona se a distância for válida
                profile.distanciaKm = distanceInKm;
                profiles.push(profile);
              }
            }
          }
        }
      }

      return profiles;
    } catch (error) {
      console.error('Erro ao buscar perfis próximos:', error);
      return [];
    }
  }
}
