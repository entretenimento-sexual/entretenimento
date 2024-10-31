// src/app/store/effects/effects.user/terms.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import * as TermsActions from '../../actions/actions.user/terms.actions';
import { map, catchError, of } from 'rxjs';

@Injectable()
export class TermsEffects {
  constructor(private actions$: Actions) { }

  loadTerms$ = createEffect(() =>
    this.actions$.pipe(
      ofType(TermsActions.loadTerms),
      map(() => {
        console.log("Carregando os termos");
        const terms = { /* Simulação dos termos carregados */ };
        return TermsActions.loadTermsSuccess({ terms });
      }),
      catchError(error => of(TermsActions.loadTermsFailure({ error: error.message })))
    )
  );

  acceptTerms$ = createEffect(() =>
    this.actions$.pipe(
      ofType(TermsActions.acceptTerms),
      map(action => {
        console.log(`Termos aceitos pelo usuário: ${action.userId}`);
        return TermsActions.acceptTermsSuccess({ userId: action.userId });
      }),
      catchError(error => of(TermsActions.acceptTermsFailure({ error: error.message })))
    )
  );
}
