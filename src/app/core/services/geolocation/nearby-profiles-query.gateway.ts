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

@Injectable({ providedIn: 'root' })
export class NearbyProfilesQueryGateway {
  constructor(
    private readonly db: Firestore,
    private readonly environmentInjector: EnvironmentInjector
  ) {}

  async fetchCandidates(
    latitude: number,
    longitude: number,
    maxDistanceKm: number,
    startAfterDoc?: any
  ): Promise<IUserDados[]> {
    const bounds = geohashQueryBounds(
      [latitude, longitude],
      maxDistanceKm * 1000
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

    return snapshots.flatMap((snapshot) =>
      snapshot.docs.map(
        (documentSnapshot) => documentSnapshot.data() as IUserDados
      )
    );
  }
}
