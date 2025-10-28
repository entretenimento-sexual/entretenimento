// src/app/store/effects/effects.location/nearby-profiles.effects.ts
import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { from, of } from 'rxjs';
import { catchError, map, mergeMap, withLatestFrom } from 'rxjs/operators';

import { NearbyProfilesActions } from '../../actions/actions.location/nearby-profiles.actions';
import { buildNearbyKey } from '../../states/states.location/nearby-profiles.state';
import { selectEntryByKey, selectNearbyFreshByParams } from '../../selectors/selectors.location/nearby-profiles.selectors';

import { NearbyProfilesService } from 'src/app/core/services/geolocation/near-profile.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';

@Injectable()
export class NearbyProfilesEffects {
  private readonly actions$ = inject(Actions);
  private readonly store = inject(Store);

  private readonly svc = inject(NearbyProfilesService);
  private readonly notify = inject(ErrorNotificationService);
  private readonly globalErr = inject(GlobalErrorHandlerService);

  load$ = createEffect(() =>
    this.actions$.pipe(
      ofType(NearbyProfilesActions.load), // 👈 camelCase
      mergeMap(({ params, force }) => {
        const key = buildNearbyKey(params);

        return this.store.select(selectNearbyFreshByParams(params)).pipe(
          withLatestFrom(this.store.select(selectEntryByKey(key))),
          mergeMap(([isFresh, entry]) => {
            if (isFresh && !force) {
              return of(NearbyProfilesActions.loaded({ // 👈 camelCase
                key,
                list: entry.list,
                updatedAt: entry.updatedAt || Date.now(),
              }));
            }

            return from(
              this.svc.getProfilesNearLocation(params.lat, params.lon, params.radiusKm, params.uid)
            ).pipe(
              map(list => NearbyProfilesActions.loaded({ // 👈 camelCase
                key,
                list: list ?? [],
                updatedAt: Date.now(),
              })),
              catchError((err) => {
                const message = 'Erro ao carregar perfis próximos.';
                this.notify.showError(message);
                this.globalErr.handleError(err as Error);
                return of(NearbyProfilesActions.error({ key, message })); // 👈 camelCase
              }),
            );
          })
        );
      })
    )
  );
}
