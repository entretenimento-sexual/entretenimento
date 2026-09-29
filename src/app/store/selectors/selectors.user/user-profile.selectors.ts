// src/app/store/selectors/user/user-profile.selectors.ts
import { createSelector } from '@ngrx/store';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import { selectCurrentUser, selectUsersMap } from '../selectors.user/user.selectors';

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

