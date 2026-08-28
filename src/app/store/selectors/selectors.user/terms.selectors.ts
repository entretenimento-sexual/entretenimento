// src/app/store/selectors/terms.selectors.ts
import { createSelector } from '@ngrx/store';
import { AppState } from '../../states/app.state';
import { ITermsState } from '../../states/states.user/terms.state';

export const selectTermsState = (state: AppState): ITermsState => state.terms;

export const isTermsAccepted = createSelector(
  selectTermsState,
  (state: ITermsState) => state.accepted
);
