// src/app/store/selectors/selectors.user/user.selectors.ts
// Objetivo: fonte única e previsível para “usuário atual”.
// - UID: sempre vem do AUTH (selectAuthUid)
// - Perfil: sempre vem do usersMap (state.user.users)
// - selectCurrentUser passa a ser DERIVADO (padrão plataformas grandes)
import { createSelector, MemoizedSelector } from '@ngrx/store';
import { AppState } from '../../states/app.state';
import { IUserState } from '../../states/states.user/user.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { selectAuthUid, selectAuthReady } from './auth.selectors';

export const selectUserState = (state: AppState): IUserState => state.user;

export const selectUsersMap = createSelector(
  selectUserState,
  (state) => state.users ?? {}
);

/** ✅ UID uniforme: sempre vem do AUTH */
export const selectCurrentUserUid: MemoizedSelector<AppState, string | null> = createSelector(
  selectAuthUid,
  (uid) => uid
);

/**
 * ✅ FONTE ÚNICA (RECOMENDADO):
 * Usuário atual = usersMap[authUid]
 *
 * Por que isso resolve seu problema:
 * - Elimina divergência entre CurrentUserStoreService x state.currentUser
 * - Evita “Bem-vindo, !” quando o doc já está no map mas currentUser não foi setado
 * - Facilita debug: se uid existe e map não tem, o problema é listener/regras/firestore (não “store desatualizado”)
 */
export const selectCurrentUser = createSelector(
  selectCurrentUserUid,
  selectUsersMap,
  (uid, map): IUserDados | null => (uid ? (map[uid] ?? null) : null)
);

/**
 * (Opcional) Se você ainda quer inspecionar o campo legado state.currentUser durante migração:
 * NÃO use para UI — apenas debug/telemetria.
 */
export const selectCurrentUserLegacy = createSelector(
  selectUserState,
  (s): IUserDados | null => s.currentUser ?? null
);

export const selectAllUsers = createSelector(
  selectUsersMap,
  (map) => Object.values(map)
);

/** ✅ fonte oficial do online: state.onlineUsers (query/presence) */
export const selectOnlineUsers = createSelector(
  selectUserState,
  (s) => s.onlineUsers ?? []
);

export const selectAllOnlineUsers = selectOnlineUsers;

/** ✅ recomendado: null quando não existe */
export const selectUserByIdOrNull = (uid: string) =>
  createSelector(selectUsersMap, (map) => map[uid] ?? null);

/**
 * ✅ Selector de STATUS (debug e UX):
 * - undefined (ou “boot”): auth ainda não está pronto
 * - null (ou “signed_out”): ready=true e uid=null
 * - “loading_profile”: uid existe mas usersMap ainda não tem doc
 * - “ready”: uid existe e doc existe
 */
export type CurrentUserStatus = 'boot' | 'signed_out' | 'loading_profile' | 'ready';

export const selectCurrentUserStatus = createSelector(
  selectAuthReady,
  selectCurrentUserUid,
  selectUsersMap,
  (ready, uid, map): CurrentUserStatus => {
    if (!ready) return 'boot';
    if (!uid) return 'signed_out';
    return map[uid] ? 'ready' : 'loading_profile';
  }
);

export const selectUserLoading = createSelector(selectUserState, (state) => state.loading);
export const selectUserError = createSelector(selectUserState, (state) => state.error);

export const selectHasRequiredFields = createSelector(
  selectCurrentUser,
  (user) => !!user?.municipio && !!user?.gender
);
