// src/app/store/reducers/user.reducer.ts
import { createReducer, on } from '@ngrx/store';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import {
  loadUsers,
  loadUsersSuccess,
  loadUsersFailure,
  updateUserOnlineStatus,
  loadOnlineUsersSuccess,
  setFilteredOnlineUsers,
  setCurrentUser,
  clearCurrentUser,
  addUserToState,
} from '../../actions/actions.user/user.actions';
import { loginSuccess, logoutSuccess } from '../../actions/actions.user/auth.actions';
import { initialUserState } from '../../states/states.user/user.state';

type UserMap = { [uid: string]: IUserDados };

/* ---------- Helpers puros (sem mutação) ---------- */

// insere/atualiza no dicionário users com merge superficial (last-write-wins)
function upsertUser(map: UserMap, user: IUserDados): UserMap {
  if (!user?.uid) return map;
  return {
    ...map,
    [user.uid]: {
      ...(map[user.uid] || {}),
      ...user
    }
  };
}

// insere/atualiza um usuário em um array por UID
function upsertInArray(list: IUserDados[], user: IUserDados): IUserDados[] {
  if (!user?.uid) return list;
  const idx = list.findIndex(u => u.uid === user.uid);
  if (idx === -1) return [...list, user];
  const copy = [...list];
  copy[idx] = { ...copy[idx], ...user };
  return copy;
}

// remove por UID
function removeByUid(list: IUserDados[], uid?: string | null): IUserDados[] {
  if (!uid) return list;
  return list.filter(u => u.uid !== uid);
}

// “hidrata” o mapa com uma lista (útil ao carregar usuários/onlineUsers)
function mergeListIntoMap(map: UserMap, users: IUserDados[]): UserMap {
  return users.reduce((acc, u) => upsertUser(acc, u), map);
}

/* ---------- Reducer ---------- */

export const userReducer = createReducer(
  initialUserState,

  // Ação: adicionar/atualizar um único usuário no estado
  on(addUserToState, (state, { user }) => ({
    ...state,
    users: upsertUser(state.users, user),
  })),

  // Carregamento de todos os usuários
  on(loadUsers, (state) => ({
    ...state,
    loading: true,
  })),

  on(loadUsersSuccess, (state, { users }) => {
    const merged = mergeListIntoMap(state.users, users);
    return {
      ...state,
      users: merged,
      loading: false,
      error: null,
    };
  }),

  on(loadUsersFailure, (state, { error }) => ({
    ...state,
    loading: false,
    error,
  })),

  // Carregamento de usuários online
  on(loadOnlineUsersSuccess, (state, { users }) => {
    // mantém o mapa “quente” com os online
    const mergedUsers = mergeListIntoMap(state.users, users);
    // evita duplicidade e preserva merges anteriores
    const nextOnline = users.reduce(
      (acc, u) => upsertInArray(acc, { ...u, isOnline: true }),
      [] as IUserDados[]
    );
    return {
      ...state,
      users: mergedUsers,
      onlineUsers: nextOnline,
      error: null,
    };
  }),

  // Atualiza status online; se o usuário não existir no mapa, faz um patch mínimo
  on(updateUserOnlineStatus, (state, { uid, isOnline }) => {
    const baseUser = state.users[uid] || ({ uid } as IUserDados);
    const patched = { ...baseUser, isOnline };

    // atualiza dicionário
    const users = upsertUser(state.users, patched);

    // mantém o array online coerente
    const onlineUsers = isOnline
      ? upsertInArray(state.onlineUsers, patched)
      : removeByUid(state.onlineUsers, uid);

    // se o currentUser é o mesmo, espelha o campo
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

  // Filtrados (ex.: UI aplicando filtros sobre onlineUsers)
  on(setFilteredOnlineUsers, (state, { filteredUsers }) => ({
    ...state,
    filteredUsers,
  })),

  /* --------- Sessão / autenticação --------- */

  // Quando o auth efetiva login: seta currentUser E hidrata o mapa
  on(loginSuccess, (state, { user }) => ({
    ...state,
    currentUser: user,
    users: upsertUser(state.users, user),
    // opcional: se já sabemos que está online, refletemos no array
    onlineUsers: user.isOnline ? upsertInArray(state.onlineUsers, user) : state.onlineUsers,
    loading: false,
    error: null,
  })),

  // setCurrentUser vindo de flows internos: mesmo tratamento do loginSuccess
  on(setCurrentUser, (state, { user }) => ({
    ...state,
    currentUser: user,
    users: upsertUser(state.users, user),
    onlineUsers: user.isOnline ? upsertInArray(state.onlineUsers, user) : state.onlineUsers,
  })),

  // Limpa usuário atual (não precisa limpar o mapa inteiro)
  on(clearCurrentUser, (state) => {
    const uidToRemove = state.currentUser?.uid ?? null;
    return {
      ...state,
      currentUser: null,
      // se você preferir manter o usuário no array online até o backend “confirmar”,
      // remova a linha abaixo. Aqui removemos para a UI refletir imediatamente.
      onlineUsers: removeByUid(state.onlineUsers, uidToRemove),
    };
  }),

  // Logout global
  on(logoutSuccess, (state) => {
    const uidToRemove = state.currentUser?.uid ?? null;
    return {
      ...state,
      currentUser: null,
      onlineUsers: removeByUid(state.onlineUsers, uidToRemove),
      // mantém `users` para não “piscar” a UI; se quiser limpar tudo:
      // users: {},
    };
  })
);
