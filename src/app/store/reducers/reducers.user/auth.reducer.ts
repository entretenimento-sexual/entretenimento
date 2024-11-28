// src/app/store/reducers/auth.reducer.ts
import { createReducer, on } from '@ngrx/store';
import { IUserState } from '../../states/states.user/user.state';
import { loginSuccess, logoutSuccess } from '../../actions/actions.user/auth.actions'; // Importando apenas as ações de autenticação

export const initialAuthState: IUserState = {
  users: {},
  currentUser: null,
  onlineUsers: [],
  filteredUsers: [],
  loading: false,
  error: null,
};

export const authReducer = createReducer(
  initialAuthState,

  on(loginSuccess, (state, { user }) => ({
    ...state,
    currentUser: user,
  })),

  on(logoutSuccess, (state) => ({
    ...state,
    currentUser: null,
  }))
);
