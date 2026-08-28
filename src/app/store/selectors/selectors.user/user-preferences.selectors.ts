// src/app/store/selectors/selectors.user/user-preferences.selectors.ts
import { createFeatureSelector, createSelector } from '@ngrx/store';

import { STORE_FEATURE } from '../../reducers/feature-keys';
import { UserPreferencesState } from '../../states/states.user/user-preferences.state';

export const selectUserPreferencesState =
  createFeatureSelector<UserPreferencesState>(STORE_FEATURE.userPreferences);

export const selectUserPreferences = (uid: string) =>
  createSelector(
    selectUserPreferencesState,
    (state) => state?.preferences?.[String(uid ?? '').trim()] ?? null
  );
