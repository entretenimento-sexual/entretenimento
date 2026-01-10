//src\app\store\reducers\reducers.user\auth.reducer.ts
import { createReducer, on } from '@ngrx/store';
import {
  loginStart, loginSuccess, loginFailure, logout, logoutSuccess, authSessionChanged
} from '../../actions/actions.user/auth.actions';
import { AuthState, //Está esmaecido
         initialAuthState } from '../../states/states.user/auth.state';

export const authReducer = createReducer(
  initialAuthState,

  on(authSessionChanged, (state, { uid, emailVerified }) => ({
    ...state,
    ready: true,
    isAuthenticated: !!uid,
    userId: uid,
    emailVerified,
    loading: false,
    error: null,
  })),

  on(loginStart, (state) => ({
    ...state,
    loading: true,
    error: null,
  })),

  // ✅ loginSuccess pode continuar existindo por UX/fluxos atuais,
  // mas o "source of truth" do UID passa a ser authSessionChanged.
  on(loginSuccess, (state) => ({
    ...state,
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

  on(logoutSuccess, (state) => ({
    ...initialAuthState,
    ready: true, // ✅ já sabemos que a sessão é nula
  }))
);
