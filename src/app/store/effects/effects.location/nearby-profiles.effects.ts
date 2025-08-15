//src\app\store\effects\effects.location\nearby-profiles.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, from, map, mergeMap, of } from 'rxjs';
import * as NearbyProfilesActions from 'src/app/store/actions/actions.location/nearby-profiles.actions';
import { NearbyProfilesService } from 'src/app/core/services/geolocation/near-profile.service';

@Injectable()
export class NearbyProfilesEffects {
  constructor(
    private actions$: Actions,
    private nearbyProfilesService: NearbyProfilesService
  ) { }

  loadNearbyProfiles$ = createEffect(() =>
    this.actions$.pipe(
      ofType(NearbyProfilesActions.loadNearbyProfiles),
      mergeMap(action =>
        from(
          this.nearbyProfilesService.getProfilesNearLocation(
            action.latitude,
            action.longitude,
            action.maxDistanceKm,
            action.userUid
          )
        ).pipe(
          map(profiles =>
            NearbyProfilesActions.loadNearbyProfilesSuccess({ profiles })
          ),
          catchError(error =>
            of(NearbyProfilesActions.loadNearbyProfilesFailure({ error }))
          )
        )
      )
    )
  );
}
