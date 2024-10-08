// src\app\store\reducers\terms.reducer.ts
import { Action, createReducer, on } from '@ngrx/store';
import { acceptTerms } from '../actions/terms.actions';
import { ITermsState, initialTermsState } from '../states/terms.state';

const _termsReducer = createReducer(
  initialTermsState,
  on(acceptTerms, (state) => ({ ...state, accepted: true }))
);

export function termsReducer(state: ITermsState | undefined, action: Action): ITermsState {
  return _termsReducer(state, action);
}
