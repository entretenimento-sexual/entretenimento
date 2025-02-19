// src\app\store\reducers\reducers.user\user-preferences.reducer.ts
import { createReducer, on } from '@ngrx/store';
import { IUserPreferences } from 'src/app/core/interfaces/interfaces-user-dados/iuser-preferences';
import { loadUserPreferencesSuccess, updateUserPreferences } from '../../actions/actions.user/user-preferences.actions';

export interface UserPreferencesState {
  preferences: { [uid: string]: IUserPreferences };
}

const initialState: UserPreferencesState = {
  preferences: {}
};

export const userPreferencesReducer = createReducer(
  initialState,
  on(loadUserPreferencesSuccess, (state, { uid, preferences }) => ({
    ...state,
    preferences: { ...state.preferences, [uid]: preferences }
  })),
  on(updateUserPreferences, (state, { uid, preferences }) => ({
    ...state,
    preferences: {
      ...state.preferences,
      [uid]: { ...state.preferences[uid], ...preferences }
    }
  }))
);
