//src\app\store\effects\effects.location
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { NearbyProfilesService } from 'src/app/core/services/geolocation/near-profile.service';
import { loadNearbyProfiles, loadNearbyProfilesSuccess, loadNearbyProfilesFailure } from 'src/app/store/actions/actions.location/location.actions';
import { mergeMap } from 'rxjs/operators';


@Injectable()
export class LocationEffects {
  constructor(
    private actions$: Actions,
    private nearbyProfilesService: NearbyProfilesService
  ) { }

  loadNearbyProfiles$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadNearbyProfiles),
      mergeMap((action) =>
        this.nearbyProfilesService
          .getProfilesNearLocation(action.latitude, action.longitude, action.maxDistanceKm, 'userUid')
          .then((profiles) => loadNearbyProfilesSuccess({ profiles }))
          .catch((error) => loadNearbyProfilesFailure({ error: error.message }))
      )
    )
  );
}
