// src\app\store\actions\actions.user\user-preferences.actions.ts
import { createAction, props } from '@ngrx/store';
import { IUserPreferences } from 'src/app/core/interfaces/interfaces-user-dados/iuser-preferences';

export const loadUserPreferences = createAction(
  '[User Preferences] Load Preferences',
  props<{ uid: string }>()
);

export const loadUserPreferencesSuccess = createAction(
  '[User Preferences] Load Preferences Success',
  props<{ uid: string, preferences: IUserPreferences }>()
);

export const loadUserPreferencesFailure = createAction(
  '[User Preferences] Load Preferences Failure',
  props<{ error: any }>()
);

export const updateUserPreferences = createAction(
  '[User Preferences] Update Preferences',
  props<{ uid: string, preferences: Partial<IUserPreferences> }>()
);
