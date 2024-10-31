// src/app/store/actions/actions.user/terms.actions.ts
import { createAction, props } from '@ngrx/store';

export const TERMS_ACTION_TYPES = {
  ACCEPT_TERMS: '[Terms] Accept Terms',
  LOAD_TERMS: '[Terms] Load Terms',
  LOAD_TERMS_SUCCESS: '[Terms] Load Terms Success',
  LOAD_TERMS_FAILURE: '[Terms] Load Terms Failure',
  ACCEPT_TERMS_SUCCESS: '[Terms] Accept Terms Success',
  ACCEPT_TERMS_FAILURE: '[Terms] Accept Terms Failure',
};

export const acceptTerms = createAction(TERMS_ACTION_TYPES.ACCEPT_TERMS, props<{ userId: string }>());
export const loadTerms = createAction(TERMS_ACTION_TYPES.LOAD_TERMS);
export const loadTermsSuccess = createAction(TERMS_ACTION_TYPES.LOAD_TERMS_SUCCESS, props<{ terms: any }>());
export const loadTermsFailure = createAction(TERMS_ACTION_TYPES.LOAD_TERMS_FAILURE, props<{ error: string }>());
export const acceptTermsSuccess = createAction(TERMS_ACTION_TYPES.ACCEPT_TERMS_SUCCESS, props<{ userId: string }>());
export const acceptTermsFailure = createAction(TERMS_ACTION_TYPES.ACCEPT_TERMS_FAILURE, props<{ error: string }>());
