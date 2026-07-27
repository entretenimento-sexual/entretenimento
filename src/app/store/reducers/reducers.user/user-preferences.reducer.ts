// src/app/store/reducers/reducers.user/user-preferences.reducer.ts
import { createReducer, on } from '@ngrx/store';

import {
  loadUserPreferencesSuccess,
  updateUserPreferences,
} from '../../actions/actions.user/user-preferences.actions';
import {
  initialUserPreferencesState,
  UserPreferencesState,
} from '../../states/states.user/user-preferences.state';

function normalizeUid(uid: string): string {
  return String(uid ?? '').trim();
}

export const userPreferencesReducer = createReducer(
  initialUserPreferencesState,

  on(
    loadUserPreferencesSuccess,
    (state, { uid, preferences }): UserPreferencesState => {
      const safeUid = normalizeUid(uid);
      if (!safeUid) return state;

      return {
        ...state,
        preferences: {
          ...state.preferences,
          [safeUid]: { ...(preferences ?? {}) },
        },
      };
    }
  ),

  on(
    updateUserPreferences,
    (state, { uid, preferences }): UserPreferencesState => {
      const safeUid = normalizeUid(uid);
      if (!safeUid) return state;

      return {
        ...state,
        preferences: {
          ...state.preferences,
          [safeUid]: {
            ...(state.preferences[safeUid] ?? {}),
            ...(preferences ?? {}),
          },
        },
      };
    }
  )
);
