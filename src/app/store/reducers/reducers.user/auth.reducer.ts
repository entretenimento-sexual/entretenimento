//src\app\store\reducers\reducers.user\auth.reducer.ts
import { createReducer, on } from '@ngrx/store';
import {
  loginStart,
  loginSuccess,
  loginFailure,
  logout,
  logoutSuccess,
} from '../../actions/actions.user/auth.actions';
import {
  AuthState,
  initialAuthState,
} from '../../states/states.user/auth.state';

export const authReducer = createReducer(
  initialAuthState,

  on(loginStart, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  on(loginSuccess, (state, { user }) => ({
    ...state,
    isAuthenticated: true,
    userId: user.uid,
    loading: false,
    error: null,
  })),

  on(loginFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  on(logout, (state) => ({
    ...state,
    loading: true,
  })),

  on(logoutSuccess, () => ({
    ...initialAuthState,
  }))
);
