// src/app/store/selectors/user/user-profile.selectors.ts
import { createSelector } from '@ngrx/store';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import { selectCurrentUser, selectUsersMap } from '../selectors.user/user.selectors';

/**
 * Perfil atual derivado da fonte unificada:
 * - UID vem do auth
 * - perfil vem do usersMap
 *
 * Não usar state.currentUser como fonte principal.
 */
export const selectUserProfileData = createSelector(
  selectCurrentUser,
  (user: IUserDados | null): Partial<IUserDados> | null => {
    if (!user) return null;

    return {
      uid: user.uid,
      emailVerified: user.emailVerified,
      latitude: user.latitude,
      firstLogin: user.firstLogin,
      createdAt: user.createdAt || user.firstLogin,
    };
  }
);

/**
 * Busca perfil por UID no mapa de usuários.
 * Selector puro, sem logs.
 */
export const selectUserProfileDataByUid = (uid: string) =>
  createSelector(selectUsersMap, (usersMap): IUserDados | null => {
    const safeUid = (uid ?? '').trim();
    if (!safeUid) return null;
    return usersMap[safeUid] ?? null;
  });

/**
 * UID do perfil atual derivado do selector principal.
 */
export const selectUserUID = createSelector(
  selectCurrentUser,
  (user) => user?.uid ?? null
);

/**
 * Estado de verificação do e-mail do perfil atual.
 */
export const selectUserEmailVerified = createSelector(
  selectCurrentUser,
  (user) => user?.emailVerified === true
);
