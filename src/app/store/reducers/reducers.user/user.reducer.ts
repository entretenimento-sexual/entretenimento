// src/app/store/reducers/reducers.user/user.reducer.ts
// -----------------------------------------------------------------------------
// UserReducer
// -----------------------------------------------------------------------------
//
// Responsabilidade:
// - manter o estado local de usuários;
// - manter currentUser separado de usersMap;
// - armazenar onlineUsers como lista derivada do fluxo de presença;
// - materializar perfis públicos recebidos por onlineUsers dentro de usersMap;
// - evitar que presence cru sobrescreva dados persistentes de perfil.
//
// Decisão desta revisão:
// - loadOnlineUsersSuccess agora atualiza:
//   1) state.onlineUsers;
//   2) state.users.
//
// Motivo:
// - o OnlineUsersEffects já hidrata public_profiles + presence;
// - se usersMap não for atualizado, o selector pode preferir um perfil antigo;
// - isso pode causar inputTotal: 0 no OnlineUsersComponent mesmo com
//   hydratedOnlineTotal: 1 no effect.
//
// Segurança:
// - reducer não consulta Firestore;
// - reducer não decide elegibilidade pública;
// - reducer apenas normaliza/sanitiza e mantém estado previsível.
//
// Manutenção:
// - helpers puros;
// - merge centralizado;
// - compatibilidade mantida com updateUserOnlineStatus legado.

import { createReducer, on } from '@ngrx/store';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import {
  observeUserChanges,
  loadUsers,
  loadUsersSuccess,
  loadUsersFailure,
  updateUserOnlineStatus, // @deprecated legado: manter até migração total para presence.
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

import {
  loginSuccess,
  logoutSuccess,
} from '../../actions/actions.user/auth.actions';

import { initialUserState } from '../../states/states.user/user.state';

import { sanitizeUserForStore } from 'src/app/store/utils/user-store.serializer';

type UserMap = Record<string, IUserDados>;

/* ============================================================================
   Helpers puros
   ========================================================================== */

function toCleanUid(uid: unknown): string | null {
  if (typeof uid !== 'string') {
    return null;
  }

  const clean = uid.trim();

  return clean.length ? clean : null;
}

function sanitizeOrNull(user: IUserDados | null | undefined): IUserDados | null {
  if (!user) {
    return null;
  }

  const safe = sanitizeUserForStore(user);

  return safe?.uid ? safe : null;
}

function upsertUser(
  map: UserMap | null | undefined,
  user: IUserDados | null | undefined
): UserMap {
  const safe = sanitizeOrNull(user);

  if (!safe?.uid) {
    return map ?? {};
  }

  const current = map?.[safe.uid];

  return {
    ...(map ?? {}),
    [safe.uid]: {
      ...(current ?? {}),
      ...safe,
    },
  };
}

function upsertInArray(
  list: IUserDados[] | null | undefined,
  user: IUserDados | null | undefined
): IUserDados[] {
  const safe = sanitizeOrNull(user);

  if (!safe?.uid) {
    return list ?? [];
  }

  const source = Array.isArray(list) ? list : [];
  const index = source.findIndex((item) => item.uid === safe.uid);

  if (index === -1) {
    return [...source, safe];
  }

  const copy = [...source];

  copy[index] = {
    ...copy[index],
    ...safe,
  };

  return copy;
}

function mergeListIntoMap(
  map: UserMap | null | undefined,
  users: IUserDados[] | null | undefined
): UserMap {
  return (users ?? []).reduce(
    (acc, user) => upsertUser(acc, user),
    map ?? {}
  );
}

function normalizeUserList(
  users: IUserDados[] | null | undefined
): IUserDados[] {
  return (users ?? []).reduce(
    (acc, user) => upsertInArray(acc, user),
    [] as IUserDados[]
  );
}

function removeByUid(
  list: IUserDados[] | null | undefined,
  uid?: string | null
): IUserDados[] {
  const cleanUid = toCleanUid(uid);

  if (!cleanUid) {
    return list ?? [];
  }

  return (list ?? []).filter((user) => user.uid !== cleanUid);
}

function removeFromMap(
  map: UserMap | null | undefined,
  uid?: string | null
): UserMap {
  const cleanUid = toCleanUid(uid);
  const source = map ?? {};

  if (!cleanUid || !source[cleanUid]) {
    return source;
  }

  const { [cleanUid]: _removed, ...rest } = source;

  return rest;
}

/* ============================================================================
   Reducer
   ========================================================================== */

export const userReducer = createReducer(
  initialUserState,

  /* --------------------------------------------------------------------------
     Ciclo do current user
     -------------------------------------------------------------------------- */

  on(observeUserChanges, (state, { uid }) => {
    const cleanUid = toCleanUid(uid);
    const sameUid = !!cleanUid && state.currentUser?.uid === cleanUid;

    return {
      ...state,
      currentUser: sameUid ? state.currentUser : null,
      currentUserLoading: true,
      currentUserHydrated: false,
      error: null,
    };
  }),

  on(setCurrentUser, (state, { user }) => {
    const safe = sanitizeOrNull(user);

    if (!safe) {
      return {
        ...state,
        currentUser: null,
        currentUserLoading: false,
        currentUserHydrated: true,
        error: null,
      };
    }

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

  /* --------------------------------------------------------------------------
     CRUD / lista geral
     -------------------------------------------------------------------------- */

  on(addUserToState, (state, { user }) => ({
    ...state,
    users: upsertUser(state.users, user),
  })),

  /**
   * updatedData é patch parcial.
   * O merge oficial continua centralizado no reducer.
   */
  on(updateUserInState, (state, { uid, updatedData }) => {
    const safeUid = toCleanUid(uid);

    if (!safeUid) {
      return state;
    }

    const merged = sanitizeOrNull({
      ...(state.users?.[safeUid] ?? ({ uid: safeUid } as IUserDados)),
      ...(updatedData ?? {}),
      uid: safeUid,
    } as IUserDados);

    if (!merged) {
      return state;
    }

    return {
      ...state,
      users: upsertUser(state.users, merged),
      currentUser:
        state.currentUser?.uid === safeUid
          ? {
              ...state.currentUser,
              ...merged,
            }
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

  /* --------------------------------------------------------------------------
     Online users
     -------------------------------------------------------------------------- */

  on(loadOnlineUsersSuccess, (state, { users }) => {
    /**
     * O effect atual entrega usuários online já hidratados:
     * public_profiles + presença.
     *
     * Portanto:
     * - onlineUsers guarda a lista visível/online;
     * - usersMap também deve ser atualizado com esses perfis públicos.
     *
     * Isso impede que selectors usem uma versão antiga do perfil persistente.
     */
    const nextOnline = normalizeUserList(users);

    return {
      ...state,
      users: mergeListIntoMap(state.users, nextOnline),
      onlineUsers: nextOnline,
      error: null,
    };
  }),

  /**
   * Fluxo legado.
   *
   * Ainda existe para compatibilidade com pontos antigos do app.
   * O fluxo principal moderno deve vir de presence/{uid} +
   * OnlineUsersEffects + loadOnlineUsersSuccess.
   */
  on(updateUserOnlineStatus, (state, { uid, isOnline }) => {
    const safeUid = toCleanUid(uid);

    if (!safeUid) {
      return state;
    }

    const baseUser = state.users?.[safeUid] ?? ({ uid: safeUid } as IUserDados);

    const patched = sanitizeOrNull({
      ...baseUser,
      uid: safeUid,
      isOnline,
    } as IUserDados);

    if (!patched) {
      return state;
    }

    const users = upsertUser(state.users, patched);

    const onlineUsers = isOnline
      ? upsertInArray(state.onlineUsers, patched)
      : removeByUid(state.onlineUsers, safeUid);

    const currentUser =
      state.currentUser?.uid === safeUid
        ? {
            ...state.currentUser,
            isOnline,
          }
        : state.currentUser;

    return {
      ...state,
      users,
      onlineUsers,
      currentUser,
    };
  }),

  /**
   * Lista filtrada por UI/recortes locais.
   *
   * Importante:
   * - não deve substituir onlineUsers;
   * - não deve ser fonte do modo "Online" geral;
   * - pode ser usada futuramente por Região/Perto/recortes.
   */
  on(setFilteredOnlineUsers, (state, { filteredUsers }) => ({
    ...state,
    filteredUsers: normalizeUserList(filteredUsers),
  })),

  /**
   * Listener parou por gate, logout ou bloqueio.
   * Limpamos apenas os dados efêmeros de online.
   * usersMap permanece como cache/materialização pública.
   */
  on(stopOnlineUsersListener, (state) => ({
    ...state,
    onlineUsers: [],
    filteredUsers: [],
  })),

  on(startOnlineUsersListener, (state) => state),

  /* --------------------------------------------------------------------------
     Compat com auth antigo
     -------------------------------------------------------------------------- */

  on(loginSuccess, (state, { user }) => {
    const safe = sanitizeOrNull(user);

    if (!safe) {
      return {
        ...state,
        currentUser: null,
        currentUserLoading: false,
        currentUserHydrated: true,
        loading: false,
        error: null,
      };
    }

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
);