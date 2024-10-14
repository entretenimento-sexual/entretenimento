// src/app/store/reducers/auth.reducer.ts
import { createReducer, on } from '@ngrx/store';
import { loginSuccess, logoutSuccess } from '../actions/auth.actions';
import { IUserState } from '../states/user.state';

export const initialAuthState: IUserState = {
  users: [],
  currentUser: null,
  onlineUsers: [],
  filteredUsers: [],
  loading: false,
  error: null,
};

export const authReducer = createReducer(
  initialAuthState,

  on(loginSuccess, (state, { user }) => {
    console.log('Login realizado com sucesso:', user);
    return {
      ...state,
      currentUser: user,
    };
  }),

  on(logoutSuccess, (state) => {
    console.log('Logout realizado com sucesso');
    return {
      ...state,
      currentUser: null,
    };
  })
);
