// src/app/store/selectors/selectors.user/user.selectors.ts
// Objetivo: fonte única e previsível para “usuário atual”.
// - UID: sempre vem do AUTH (selectAuthUid)
// - Perfil ATUAL: vem do espelho currentUser do slice user
// - usersMap continua sendo útil para listas e lookups genéricos
//
// Ajuste importante deste patch:
// - NÃO derivar o currentUser oficial a partir do usersMap
// - isso evita ressuscitar perfil stale quando o currentUser foi marcado
//   como indisponível no ciclo atual

import { createSelector } from '@ngrx/store';
import { AppState } from '../../states/app.state';
import { IUserState } from '../../states/states.user/user.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { selectAuthUid, selectAuthReady } from './auth.selectors';

export const selectUserState = (state: AppState): IUserState => state.user;

export const selectUsersMap = createSelector(
  selectUserState,
  (state): Record<string, IUserDados> => state.users ?? {}
);

/** UID uniforme: sempre vem do AUTH */
export const selectCurrentUserUid = createSelector(
  selectAuthUid,
  (uid) => uid
);

/**
 * Espelho legado/oficial do current user dentro do slice user.
 * Aqui ele deixa de ser apenas "legado" e passa a ser a base segura
 * para o current user no NgRx.
 */
export const selectCurrentUserLegacy = createSelector(
  selectUserState,
  (state): IUserDados | null => state.currentUser ?? null
);

/**
 * Flags explícitas do ciclo do current user.
 */
export const selectCurrentUserLoading = createSelector(
  selectUserState,
  (state) => state.currentUserLoading === true
);

export const selectCurrentUserHydrated = createSelector(
  selectUserState,
  (state) => state.currentUserHydrated === true
);

/**
 * FONTE OFICIAL DO PERFIL ATUAL NO STORE:
 * - auth define QUEM é o usuário atual (uid)
 * - o slice user.currentUser define QUAL perfil do ciclo atual está válido
 *
 * Regras:
 * - sem ready -> null
 * - sem uid -> null
 * - durante loading -> preserva o currentUser apenas se ele corresponder ao uid atual
 * - se o ciclo ainda não foi hidratado -> null
 * - se o currentUser não bater com o uid atual -> null
 */
export const selectCurrentUser = createSelector(
  selectAuthReady,
  selectCurrentUserUid,
  selectCurrentUserLegacy,
  selectCurrentUserLoading,
  selectCurrentUserHydrated,
  (ready, uid, currentUser, loading, hydrated): IUserDados | null => {
    if (!ready) return null;
    if (!uid) return null;

    if (loading) {
      return currentUser?.uid === uid ? currentUser : null;
    }

    if (!hydrated) {
      return null;
    }

    if (currentUser?.uid !== uid) {
      return null;
    }

    return currentUser;
  }
);

export const selectAllUsers = createSelector(
  selectUsersMap,
  (map) => Object.values(map ?? {})
);

/** Fonte oficial do online: state.onlineUsers */
export const selectOnlineUsers = createSelector(
  selectUserState,
  (state) => state.onlineUsers ?? []
);

export const selectAllOnlineUsers = selectOnlineUsers;

export const selectUserByIdOrNull = (uid: string) =>
  createSelector(selectUsersMap, (map) => {
    const safeUid = (uid ?? '').trim();
    if (!safeUid) return null;
    return map[safeUid] ?? null;
  });

/**
 * Status do current user.
 *
 * boot:
 * - auth ainda não terminou bootstrap
 *
 * signed_out:
 * - auth pronto e uid nulo
 *
 * loading_profile:
 * - auth pronto, uid existe, e users/{uid} ainda está em hidratação
 *   ou o store ainda não concluiu o ciclo atual
 *
 * unavailable:
 * - o ciclo concluiu, mas não há perfil válido disponível
 *
 * ready:
 * - uid existe e perfil atual está hidratado/disponível
 */
export type CurrentUserStatus =
  | 'boot'
  | 'signed_out'
  | 'loading_profile'
  | 'unavailable'
  | 'ready';

export const selectCurrentUserStatus = createSelector(
  selectAuthReady,
  selectCurrentUserUid,
  selectCurrentUser,
  selectCurrentUserLoading,
  selectCurrentUserHydrated,
  (ready, uid, currentUser, loading, hydrated): CurrentUserStatus => {
    if (!ready) return 'boot';
    if (!uid) return 'signed_out';
    if (loading || !hydrated) return 'loading_profile';
    if (!currentUser || currentUser.uid !== uid) return 'unavailable';
    return 'ready';
  }
);

export const selectUserLoading = createSelector(
  selectUserState,
  (state) => state.loading
);

export const selectUserError = createSelector(
  selectUserState,
  (state) => state.error
);

export const selectHasRequiredFields = createSelector(
  selectCurrentUser,
  (user) => !!user?.municipio && !!user?.gender
);
