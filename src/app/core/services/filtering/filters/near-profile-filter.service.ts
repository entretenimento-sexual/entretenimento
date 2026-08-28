//src\app\core\services\filtering\filters\near-profile-filter.service.ts
import { Injectable } from '@angular/core';
import { QueryConstraint, where } from 'firebase/firestore';
import { DistanceCalculationService } from '../../geolocation/distance-calculation.service';

@Injectable({
  providedIn: 'root',
})
export class NearProfileFilterService {
  constructor(private distanceService: DistanceCalculationService) { }

  applyFilter(currentLocation: { lat: number; lng: number }, maxDistanceKm: number): QueryConstraint[] {
    // Ajuste para incluir geohashes ou outras implementações específicas.
    return [];
  }
}
