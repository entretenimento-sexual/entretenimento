// src/app/store/reducers/user.reducer.ts
import { createReducer, on } from '@ngrx/store';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import {
  loadUsers, loadUsersSuccess, loadUsersFailure, updateUserOnlineStatus,
  loadOnlineUsersSuccess, setFilteredOnlineUsers, setCurrentUser,
  clearCurrentUser, addUserToState
} from '../../actions/actions.user/user.actions';
import { initialUserState } from '../../states/states.user/user.state';

function addUniqueUsers(existingUsers: IUserDados[], newUsers: IUserDados[]): IUserDados[] {
  return [
    ...existingUsers,
    ...newUsers.filter(newUser => !existingUsers.some(existingUser => existingUser.uid === newUser.uid))
  ];
}

export const userReducer = createReducer(
  initialUserState,

  on(addUserToState, (state, { user }) => {
    if (state.users.some(existingUser => existingUser.uid === user.uid)) {
      return state; // Retorna sem alterações se o usuário já existir
    }
    console.log('Ação disparada: Add User to State', user);
    return {
      ...state,
      users: [...state.users, user]
    };
  }),

  on(loadUsers, state => ({ ...state, loading: true })),

  on(loadUsersSuccess, (state, { users }) => {
    const updatedUsers = addUniqueUsers(state.users, users);
    console.log('Usuários carregados e armazenados no estado (sem duplicação):', updatedUsers.length);
    return {
      ...state,
      users: updatedUsers,
      loading: false,
      error: null,
    };
  }),

  on(loadUsersFailure, (state, { error }) => {
    console.error('Erro ao carregar usuários:', error);
    return { ...state, loading: false, error };
  }),

  on(updateUserOnlineStatus, (state, { uid, isOnline }) => {
    const updatedUsers: IUserDados[] = state.users.map(user =>
      user.uid === uid ? { ...user, isOnline } : user
    );
    return { ...state, users: updatedUsers };
  }),

  on(loadOnlineUsersSuccess, (state, { users }) => {
    const uniqueOnlineUsers = addUniqueUsers(state.onlineUsers, users);
    console.log('Usuários online carregados (sem duplicação):', uniqueOnlineUsers.length);
    return { ...state, onlineUsers: uniqueOnlineUsers };
  }),

  on(setFilteredOnlineUsers, (state, { filteredUsers }) => ({
    ...state,
    filteredUsers
  })),

  on(setCurrentUser, (state, { user }) => ({
    ...state,
    currentUser: user
  })),

  on(clearCurrentUser, (state) => ({
    ...state,
    currentUser: null
  }))
);
