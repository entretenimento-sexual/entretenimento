// src/app/store/reducers/online-users.reducer.ts
import { createReducer, on } from '@ngrx/store';
import { loadOnlineUsersSuccess, updateUserOnlineStatus, setFilteredOnlineUsers } from '../actions/user.actions';
import { IUserState } from '../states/user.state';

const initialOnlineUsersState: IUserState = {
  users: [],
  currentUser: null,
  onlineUsers: [],
  filteredUsers: [],
  loading: false,
  error: null,
};

export const onlineUsersReducer = createReducer(
  initialOnlineUsersState,

  on(loadOnlineUsersSuccess, (state, { users }) => {
    console.log('Usuários online carregados com sucesso:', users);
    return {
      ...state,
      onlineUsers: users,
    };
  }),

  on(updateUserOnlineStatus, (state, { uid, isOnline }) => {
    console.log(`Atualizando status online do usuário ${uid}: ${isOnline}`);
    const updatedOnlineUsers = state.onlineUsers.map(user =>
      user.uid === uid ? { ...user, isOnline } : user
    );
    return {
      ...state,
      onlineUsers: updatedOnlineUsers,
    };
  }),

  on(setFilteredOnlineUsers, (state, { filteredUsers }) => {
    console.log('Usuários online filtrados:', filteredUsers);
    return {
      ...state,
      filteredUsers,
    };
  })
);
