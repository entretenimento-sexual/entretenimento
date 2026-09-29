// src/app/store/selectors/selectors.user/auth.selectors.ts
import { createSelector } from '@ngrx/store';
import { AppState } from '../../states/app.state';
import { AuthState, initialAuthState } from '../../states/states.user/auth.state';

export const selectAuthState = (s: AppState | undefined): AuthState => s?.auth ?? initialAuthState;

export const selectIsAuthenticated = createSelector(
  selectAuthState,
  (state) => state.isAuthenticated
);

export const selectAuthUid = createSelector(
  selectAuthState,
  (state) => state.userId
);

export const selectAuthEmailVerified = createSelector(
  selectAuthState,
  (state) => state.emailVerified
);

export const selectAuthReady = createSelector(
  selectAuthState,
  (state) => state.ready
);


