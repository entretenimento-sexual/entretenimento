import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { geohashQueryBounds } from 'geofire-common';

import { IUserDados } from '../../interfaces/iuser-dados';
import {
  PublicProfileReadBoundaryService,
} from '../discovery/public-profile-read-boundary.service';

@Injectable({ providedIn: 'root' })
export class NearbyProfilesQueryGateway {
  private readonly publicProfileRead = inject(
    PublicProfileReadBoundaryService
  );

  async fetchCandidates(
    latitude: number,
    longitude: number,
    maxDistanceKm: number,
    _startAfterDoc?: unknown
  ): Promise<IUserDados[]> {
    const bounds = geohashQueryBounds(
      [latitude, longitude],
      maxDistanceKm * 1000
    ).map(([start, end]) => ({ start, end }));

    const response = await firstValueFrom(
      this.publicProfileRead.read$({
        mode: 'all',
        pageSize: 120,
        nearby: {
          latitude,
          longitude,
          maxDistanceKm,
          bounds,
        },
      })
    );

    return (response.items ?? []).map((raw) => ({
      ...(raw as unknown as IUserDados),
      uid: String(raw['uid'] ?? '').trim(),
      age: null,
    }));
  }
}
