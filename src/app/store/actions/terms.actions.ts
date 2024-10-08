// src/app/store/actions/terms.actions.ts
import { createAction } from '@ngrx/store';

/**
 * Terms Action Types
 */
export const TERMS_ACTION_TYPES = {
  ACCEPT_TERMS: '[Terms] Accept Terms',
};

/**
 * Action to accept the terms and conditions.
 */
export const acceptTerms = createAction(TERMS_ACTION_TYPES.ACCEPT_TERMS);
