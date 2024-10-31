// src/app/store/reducers/auth.reducer.ts
import { createReducer, on } from '@ngrx/store';
import { IUserState } from '../../states/states.user/user.state';
import { loginSuccess, logoutSuccess } from '../../actions/actions.user/auth.actions';

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
