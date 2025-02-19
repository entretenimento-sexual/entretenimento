// src\app\store\effects\effects.user\user-preferences.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, map, switchMap } from 'rxjs/operators';
import { of } from 'rxjs';
import { UserPreferencesService } from 'src/app/core/services/preferences/user-preferences.service';
import { loadUserPreferences, loadUserPreferencesFailure, loadUserPreferencesSuccess } from '../../actions/actions.user/user-preferences.actions';

@Injectable()
export class UserPreferencesEffects {

  loadPreferences$ = createEffect(() =>
    this.actions$.pipe(
      ofType(loadUserPreferences),
      switchMap(({ uid }) =>
        this.userPreferencesService.getUserPreferences$(uid).pipe(
          map(preferences => loadUserPreferencesSuccess({ uid, preferences })),
          catchError(error => of(loadUserPreferencesFailure({ error })))
        )
      )
    )
  );

  constructor(
    private actions$: Actions,
    private userPreferencesService: UserPreferencesService
  ) { }
}
