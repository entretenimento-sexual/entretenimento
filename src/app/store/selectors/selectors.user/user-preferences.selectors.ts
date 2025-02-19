// src\app\store\selectors\selectors.user\user-preferences.selectors.ts
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { UserPreferencesState } from '../../reducers/reducers.user/user-preferences.reducer';

// 🔹 Verifica se a feature 'userPreferences' foi corretamente registrada
export const selectUserPreferencesState = createFeatureSelector<UserPreferencesState>('userPreferences');

// 🔹 Adiciona proteção para evitar acesso a `undefined`
export const selectUserPreferences = (uid: string) => createSelector(
  selectUserPreferencesState,
  (state) => state?.preferences?.[uid] || null
);
