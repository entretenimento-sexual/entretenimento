// src/app/core/services/geolocation/location-persistence.service.ts
import { Injectable, inject } from '@angular/core';
import { doc, setDoc, serverTimestamp } from '@angular/fire/firestore';
import { Firestore } from '@angular/fire/firestore';
import { GeoCoordinates } from '../../interfaces/geolocation.interface';

@Injectable({ providedIn: 'root' })
export class LocationPersistenceService {
  private fs = inject(Firestore);

  async saveUserLocation(uid: string, coords: GeoCoordinates, geohash?: string): Promise<void> {
    const ref = doc(this.fs, 'users', uid);
    await setDoc(ref, {
      latitude: coords.latitude,
      longitude: coords.longitude,
      geohash: geohash ?? coords.geohash ?? null,
      locationUpdatedAt: serverTimestamp(),
    }, { merge: true });
  }
}
