// src/app/store/selectors/selectors.user/online.selectors.ts
// src/app/store/selectors/selectors.user/online.selectors.ts
import { createSelector } from '@ngrx/store';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { selectUsersMap, selectOnlineUsers } from './user.selectors';
import { selectAuthUid } from './auth.selectors';

export const selectGlobalOnlineUsers = createSelector(
  selectOnlineUsers,
  selectUsersMap,
  selectAuthUid,
  (onlineArr, usersMap, meUid): IUserDados[] => {
    const base = onlineArr?.length ? onlineArr : Object.values(usersMap);
    return base.filter(u => !!u?.uid && u.uid !== meUid && u.isOnline === true);
  }
);

export const selectGlobalOnlineCount = createSelector(
  selectGlobalOnlineUsers,
  (list) => list.length
);


/**
 * A ideia aqui é: “online” é derivado do Firestore (PresenceService),
 * então o selector NÃO deve injetar isOnline=true.
 */

/*
 AuthSession manda no UID
/*CurrentUserStore manda no IUserDados
qualquer UID fora disso vira derivado / compat
//logout() do auth.service.ts que está sendo descontinuado
// ainda está sendo usado em alguns lugares e precisa ser migrado.
Ferramentas de debug ajudam bastante
É assim que funcionam as grandes plataformas?
Compatibilizar o estado online do usuário com o presence.service e aproximar do funcionamento ideal
*/

