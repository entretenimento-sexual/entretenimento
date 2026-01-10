// src/app/store/reducers/reducers.user/user.reducer.ts
import { createReducer, on } from '@ngrx/store';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import {
  loadUsers,
  loadUsersSuccess,
  loadUsersFailure,
  updateUserOnlineStatus, // @deprecated (legado)
  loadOnlineUsersSuccess,
  setFilteredOnlineUsers,
  setCurrentUser,
  clearCurrentUser,
  addUserToState,
} from '../../actions/actions.user/user.actions';

import { loginSuccess, logoutSuccess } from '../../actions/actions.user/auth.actions';
import { initialUserState } from '../../states/states.user/user.state';

type UserMap = { [uid: string]: IUserDados };

/* ========================================================================
   Helpers puros (sem mutação) — padrão “plataforma grande”
   ======================================================================== */

function upsertUser(map: UserMap, user: IUserDados): UserMap {
  if (!user?.uid) return map;
  return {
    ...map,
    [user.uid]: {
      ...(map[user.uid] || {}),
      ...user,
    },
  };
}

function upsertInArray(list: IUserDados[], user: IUserDados): IUserDados[] {
  if (!user?.uid) return list;
  const idx = list.findIndex((u) => u.uid === user.uid);
  if (idx === -1) return [...list, user];
  const copy = [...list];
  copy[idx] = { ...copy[idx], ...user };
  return copy;
}

function removeByUid(list: IUserDados[], uid?: string | null): IUserDados[] {
  if (!uid) return list;
  return list.filter((u) => u.uid !== uid);
}

function mergeListIntoMap(map: UserMap, users: IUserDados[]): UserMap {
  return (users ?? []).reduce((acc, u) => upsertUser(acc, u), map);
}

/* ========================================================================
   Reducer
   ======================================================================== */

export const userReducer = createReducer(
  initialUserState,

  /* ------------------ Hidratação / CRUD local ------------------ */

  on(addUserToState, (state, { user }) => ({
    ...state,
    users: upsertUser(state.users, user),
  })),

  on(loadUsers, (state) => ({
    ...state,
    loading: true,
  })),

  on(loadUsersSuccess, (state, { users }) => ({
    ...state,
    users: mergeListIntoMap(state.users, users),
    loading: false,
    error: null,
  })),

  on(loadUsersFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  /**
   * ✅ OnlineUsers deve ser “o que veio da query”.
   * Ex.: UserPresenceQueryService usa where('isOnline','==',true).
   * ❌ Não forçamos isOnline=true aqui (isso causava “simulação”).
   */
  on(loadOnlineUsersSuccess, (state, { users }) => {
    const mergedUsers = mergeListIntoMap(state.users, users);

    // array coerente e sem duplicidade (last-write-wins)
    const nextOnline = (users ?? []).reduce((acc, u) => upsertInArray(acc, u), [] as IUserDados[]);

    return {
      ...state,
      users: mergedUsers,
      onlineUsers: nextOnline,
      error: null,
    };
  }),

  /**
   * @deprecated
   * Mantido por compatibilidade com fluxos antigos.
   * A presença oficial é: PresenceService -> Firestore -> Query -> loadOnlineUsersSuccess.
   */
  on(updateUserOnlineStatus, (state, { uid, isOnline }) => {
    const baseUser = state.users[uid] || ({ uid } as IUserDados);
    const patched = { ...baseUser, isOnline };

    const users = upsertUser(state.users, patched);
    const onlineUsers = isOnline ? upsertInArray(state.onlineUsers, patched) : removeByUid(state.onlineUsers, uid);

    const currentUser =
      state.currentUser?.uid === uid ? { ...state.currentUser, isOnline } : state.currentUser;

    return {
      ...state,
      users,
      onlineUsers,
      currentUser,
    };
  }),

  on(setFilteredOnlineUsers, (state, { filteredUsers }) => ({
    ...state,
    filteredUsers,
  })),

  /* ------------------ Sessão / Auth ------------------ */

  on(loginSuccess, (state, { user }) => ({
    ...state,
    currentUser: user,
    users: upsertUser(state.users, user),
    // Observação: NÃO “forçamos” entrar em onlineUsers aqui.
    // Quem controla onlineUsers é a query de presença (loadOnlineUsersSuccess).
    loading: false,
    error: null,
  })),

  on(setCurrentUser, (state, { user }) => ({
    ...state,
    currentUser: user,
    users: upsertUser(state.users, user),
  })),

  on(clearCurrentUser, (state) => {
    const uidToRemove = state.currentUser?.uid ?? null;
    return {
      ...state,
      currentUser: null,
      // Se em algum fluxo legado ele entrou no array, removemos.
      onlineUsers: removeByUid(state.onlineUsers, uidToRemove),
    };
  }),

  on(logoutSuccess, (state) => {
    const uidToRemove = state.currentUser?.uid ?? null;
    return {
      ...state,
      currentUser: null,
      onlineUsers: removeByUid(state.onlineUsers, uidToRemove),
    };
  })
);//Linha 170
