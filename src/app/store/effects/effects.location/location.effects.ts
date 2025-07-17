//src\app\store\effects\effects.location
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { NearbyProfilesService } from 'src/app/core/services/geolocation/near-profile.service';
import { loadNearbyProfiles, loadNearbyProfilesSuccess, loadNearbyProfilesFailure } from 'src/app/store/actions/actions.location/location.actions';
import { mergeMap } from 'rxjs/operators';
import { environment } from 'src/environments/environment';

@Injectable()
export class LocationEffects {
  constructor(
    private actions$: Actions,
    private nearbyProfilesService: NearbyProfilesService
  ) { }

  loadNearbyProfiles$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadNearbyProfiles),
      mergeMap((action) => {
        if (!environment.production) {
          console.log('[LocationEffects] loadNearbyProfiles acionado com coordenadas:', {
            latitude: action.latitude,
            longitude: action.longitude,
            maxDistanceKm: action.maxDistanceKm
          });
        }
        return this.nearbyProfilesService
          .getProfilesNearLocation(action.latitude, action.longitude, action.maxDistanceKm, 'userUid')
          .then((profiles) => {
            if (!environment.production) {
              console.log('[LocationEffects] loadNearbyProfilesSuccess com perfis:', profiles);
            }
            return loadNearbyProfilesSuccess({ profiles });
          })
          .catch((error) => {
            if (!environment.production) {
              console.log('[LocationEffects] Erro ao carregar perfis próximos:', error);
            }
            return loadNearbyProfilesFailure({ error: error.message });
          });
      })
    )
  );
}
