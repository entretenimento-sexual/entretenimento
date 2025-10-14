// src/app/store/selectors/selectors.user/online.selectors.ts
import { createSelector } from '@ngrx/store';
import { AppState } from '../../states/app.state';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

// pegamos tudo do slice `user`
const selectUserSlice = (s: AppState) => (s as any)?.user ?? {};

// dicionário de usuários (map)
const selectUsersMap = createSelector(
  selectUserSlice,
  (u) => (u.users ?? {}) as Record<string, IUserDados>
);

// array “onlineUsers” (se o reducer preencher)
const selectOnlineArray = createSelector(
  selectUserSlice,
  (u) => (u.onlineUsers ?? []) as IUserDados[]
);

// uid do usuário atual
const selectCurrentUserUid = createSelector(
  selectUserSlice,
  (u) => u?.currentUser?.uid ?? null
);

/** Lista global de usuários online (exclui o próprio) */
export const selectGlobalOnlineUsers = createSelector(
  selectUsersMap,
  selectOnlineArray,
  selectCurrentUserUid,
  (map, arr, meUid): IUserDados[] => {
    // se o reducer já mantém `onlineUsers`, usa-o; senão deriva do map
    const base: IUserDados[] = (arr?.length ? arr : Object.values(map)) as IUserDados[];
    return base
      .filter(u => u && u.uid && u.uid !== meUid && u.isOnline === true)
      .map(u => ({ ...u, isOnline: true })); // garante flag
  }
);

/** Contador bruto */
export const selectGlobalOnlineCount = createSelector(
  selectGlobalOnlineUsers,
  list => list.length
);
