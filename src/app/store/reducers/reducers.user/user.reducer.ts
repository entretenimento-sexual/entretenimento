// src/app/store/reducers/reducers.user/user.reducer.ts
import { createReducer, on } from '@ngrx/store';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import {
  observeUserChanges,
  loadUsers,
  loadUsersSuccess,
  loadUsersFailure,
  updateUserOnlineStatus, // @deprecated (legado)
  loadOnlineUsersSuccess,
  setFilteredOnlineUsers,
  setCurrentUser,
  clearCurrentUser,
  addUserToState,
  updateUserInState,
  startOnlineUsersListener,
  stopOnlineUsersListener,
  setCurrentUserUnavailable,
  setCurrentUserHydrationError,
} from '../../actions/actions.user/user.actions';

import { sanitizeUserForStore } from 'src/app/store/utils/user-store.serializer';
import { loginSuccess, logoutSuccess } from '../../actions/actions.user/auth.actions';
import { initialUserState } from '../../states/states.user/user.state';

type UserMap = { [uid: string]: IUserDados };

/* ========================================================================
   Helpers puros
   ======================================================================== */

function upsertUser(map: UserMap, user: IUserDados): UserMap {
  const safe = sanitizeUserForStore(user);
  if (!safe?.uid) return map;

  return {
    ...map,
    [safe.uid]: {
      ...(map[safe.uid] || {}),
      ...safe,
    },
  };
}

function upsertInArray(list: IUserDados[], user: IUserDados): IUserDados[] {
  const safe = sanitizeUserForStore(user);
  if (!safe?.uid) return list;

  const idx = list.findIndex((u) => u.uid === safe.uid);
  if (idx === -1) return [...list, safe];

  const copy = [...list];
  copy[idx] = { ...copy[idx], ...safe };
  return copy;
}

function mergeListIntoMap(map: UserMap, users: IUserDados[]): UserMap {
  return (users ?? []).reduce((acc, u) => upsertUser(acc, u), map);
}

function removeByUid(list: IUserDados[], uid?: string | null): IUserDados[] {
  if (!uid) return list;
  return list.filter((u) => u.uid !== uid);
}

function removeFromMap(map: UserMap, uid?: string | null): UserMap {
  if (!uid || !map?.[uid]) return map;

  const { [uid]: _removed, ...rest } = map;
  return rest;
}

/* ========================================================================
   Reducer
   ======================================================================== */

export const userReducer = createReducer(
  initialUserState,

  /* ------------------ Ciclo do current user ------------------ */

  on(observeUserChanges, (state, { uid }) => {
    const sameUid = state.currentUser?.uid === uid;

    return {
      ...state,
      currentUser: sameUid ? state.currentUser : null,
      currentUserLoading: true,
      currentUserHydrated: false,
      error: null,
    };
  }),

  on(setCurrentUser, (state, { user }) => {
    const safe = sanitizeUserForStore(user);

    return {
      ...state,
      currentUser: safe,
      currentUserLoading: false,
      currentUserHydrated: true,
      users: upsertUser(state.users, safe),
      error: null,
    };
  }),

  on(setCurrentUserUnavailable, (state, { error }) => {
    const uidToRemove = state.currentUser?.uid ?? null;

    return {
      ...state,
      currentUser: null,
      currentUserLoading: false,
      currentUserHydrated: true,
      users: removeFromMap(state.users, uidToRemove),
      onlineUsers: removeByUid(state.onlineUsers, uidToRemove),
      filteredUsers: [],
      error,
    };
  }),

  on(setCurrentUserHydrationError, (state, { error }) => ({
    ...state,
    currentUserLoading: false,
    currentUserHydrated: true,
    error,
  })),

  on(clearCurrentUser, (state) => {
    const uidToRemove = state.currentUser?.uid ?? null;

    return {
      ...state,
      currentUser: null,
      currentUserLoading: false,
      currentUserHydrated: true,
      users: removeFromMap(state.users, uidToRemove),
      onlineUsers: removeByUid(state.onlineUsers, uidToRemove),
      filteredUsers: [],
      error: null,
    };
  }),

  /* ------------------ CRUD / lista geral ------------------ */

  on(addUserToState, (state, { user }) => ({
    ...state,
    users: upsertUser(state.users, user),
  })),

  /**
   * updatedData agora é patch parcial.
   * O merge oficial continua centralizado aqui no reducer.
   */
  on(updateUserInState, (state, { uid, updatedData }) => {
    const safeUid = (uid ?? '').trim();
    if (!safeUid) return state;

    const merged: IUserDados = sanitizeUserForStore({
      ...(state.users[safeUid] || ({ uid: safeUid } as IUserDados)),
      ...(updatedData ?? {}),
      uid: safeUid,
    });

    return {
      ...state,
      users: upsertUser(state.users, merged),
      currentUser:
        state.currentUser?.uid === safeUid
          ? { ...state.currentUser, ...merged }
          : state.currentUser,
    };
  }),

  on(loadUsers, (state) => ({
    ...state,
    loading: true,
    error: null,
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

  /* ------------------ Online users ------------------ */

  on(loadOnlineUsersSuccess, (state, { users }) => {
    const nextOnline = (users ?? []).reduce(
      (acc, u) => upsertInArray(acc, u),
      [] as IUserDados[]
    );

    return {
      ...state,
      onlineUsers: nextOnline,
      error: null,
    };
  }),

  on(updateUserOnlineStatus, (state, { uid, isOnline }) => {
    const baseUser = state.users[uid] || ({ uid } as IUserDados);
    const patched = { ...baseUser, isOnline };

    const users = upsertUser(state.users, patched);
    const onlineUsers = isOnline
      ? upsertInArray(state.onlineUsers, patched)
      : removeByUid(state.onlineUsers, uid);

    const currentUser =
      state.currentUser?.uid === uid
        ? { ...state.currentUser, isOnline }
        : state.currentUser;

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

  on(stopOnlineUsersListener, (state) => ({
    ...state,
    onlineUsers: [],
    filteredUsers: [],
  })),

  on(startOnlineUsersListener, (state) => state),

  /* ------------------ Compat com auth antigo ------------------ */

  on(loginSuccess, (state, { user }) => {
    const safe = sanitizeUserForStore(user);

    return {
      ...state,
      currentUser: safe,
      currentUserLoading: false,
      currentUserHydrated: true,
      users: upsertUser(state.users, safe),
      loading: false,
      error: null,
    };
  }),

  on(logoutSuccess, (state) => {
    const uidToRemove = state.currentUser?.uid ?? null;

    return {
      ...state,
      currentUser: null,
      currentUserLoading: false,
      currentUserHydrated: true,
      users: removeFromMap(state.users, uidToRemove),
      onlineUsers: removeByUid(state.onlineUsers, uidToRemove),
      filteredUsers: [],
      error: null,
    };
  })
); //Linha 275, fim do userReducer
