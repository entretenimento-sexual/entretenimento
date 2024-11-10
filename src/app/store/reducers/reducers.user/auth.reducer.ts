// src/app/store/reducers/auth.reducer.ts
import { createReducer, on } from '@ngrx/store';
import { IUserState } from '../../states/states.user/user.state';
import { loginSuccess, logoutSuccess, userOffline } from '../../actions/actions.user/auth.actions';

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

  on(loginSuccess, (state, { user }) => ({
    ...state,
    currentUser: user,
  })),

  on(logoutSuccess, (state) => ({
    ...state,
    currentUser: null,
  })),

  on(userOffline, (state, { uid }) => {
    if (state.currentUser && state.currentUser.uid === uid) {
      return {
        ...state,
        currentUser: {
          ...state.currentUser,
          isOnline: false,
        },
      };
    }
    return state;
  })
);
