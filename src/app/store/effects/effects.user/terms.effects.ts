// src/app/store/effects/effects.user/terms.effects.ts
import { Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import * as TermsActions from '../../actions/actions.user/terms.actions';
import { switchMap, of } from 'rxjs';

@Injectable()
export class TermsEffects {
  constructor(private actions$: Actions) { }

  loadTerms$ = createEffect(() =>
    this.actions$.pipe(
      ofType(TermsActions.loadTerms),
      switchMap(() => {
        console.log('[TermsEffects] Carregando os termos...');
        const terms = { texto: 'Termos simulados para exibição.' };
        return of(TermsActions.loadTermsSuccess({ terms }));
      })
    )
  );

  acceptTerms$ = createEffect(() =>
    this.actions$.pipe(
      ofType(TermsActions.acceptTerms),
      switchMap(action => {
        console.log(`[TermsEffects] Termos aceitos pelo usuário: ${action.userId}`);
        return of(TermsActions.acceptTermsSuccess({ userId: action.userId }));
      })
    )
  );
}
