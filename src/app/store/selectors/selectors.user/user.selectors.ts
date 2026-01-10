//src\app\store\selectors\selectors.user\user.selectors.ts
import { createSelector, MemoizedSelector } from '@ngrx/store';
import { AppState } from '../../states/app.state';
import { IUserState } from '../../states/states.user/user.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { selectAuthUid } from './auth.selectors';

export const selectUserState = (state: AppState): IUserState => state.user;

export const selectCurrentUser = createSelector(
  selectUserState,
  (state): IUserDados | null => state.currentUser ?? null
);

/** ✅ UID uniforme: sempre vem do AUTH */
export const selectCurrentUserUid: MemoizedSelector<AppState, string | null> = createSelector(
  selectAuthUid,
  (uid) => uid
);

export const selectUsersMap = createSelector(
  selectUserState,
  (state) => state.users ?? {}
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

// compat
export const selectAllOnlineUsers = selectOnlineUsers;

/** ✅ recomendado: null quando não existe */
export const selectUserByIdOrNull = (uid: string) =>
  createSelector(selectUsersMap, (map) => map[uid] ?? null);

/** compat “safe”: evita quebrar UI, mas não mascara uid */
function fallbackUser(uid: string): IUserDados {
  return {
    uid,
    email: null,
    photoURL: null,
    role: 'visitante',
    lastLogin: 0,
    descricao: '',
    isSubscriber: false,
  };
}

/** @deprecated prefira selectUserByIdOrNull */
export const selectUserById = (uid: string) =>
  createSelector(selectUsersMap, (map) => map[uid] ?? fallbackUser(uid));

export const selectOnlineUsersByRegion = (region: string) =>
  createSelector(selectOnlineUsers, (onlineUsers) => {
    const normalized = region.trim().toLowerCase();
    return onlineUsers.filter(u => (u.municipio?.trim().toLowerCase() || '') === normalized);
  });

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

/* CurrentUserStore manda no IUserDados
qualquer UID fora disso vira derivado / compat
//logout() do auth.service.ts que está sendo descontinuado
// ainda está sendo usado em alguns lugares e precisa ser migrado.
Ferramentas de debug ajudam bastante
É assim que funcionam as grandes plataformas ?
*/
