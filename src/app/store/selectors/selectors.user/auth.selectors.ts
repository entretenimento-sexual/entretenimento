//src\app\store\selectors\selectors.user\auth.selectors.ts
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { AuthState } from '../../states/states.user/auth.state';

export const selectAuthState = createFeatureSelector<AuthState>('authState');

// Verifica se está autenticado
export const selectIsAuthenticated = createSelector(
  selectAuthState,
  (state: AuthState) => state.isAuthenticated
);

// ID do usuário autenticado
export const selectAuthUserId = createSelector(
  selectAuthState,
  (state: AuthState) => state.userId
);

// Estado de carregamento
export const selectAuthLoading = createSelector(
  selectAuthState,
  (state: AuthState) => state.loading
);

// Erro
export const selectAuthError = createSelector(
  selectAuthState,
  (state: AuthState) => state.error
);
