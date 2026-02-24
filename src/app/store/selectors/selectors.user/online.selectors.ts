// src/app/store/selectors/selectors.user/online.selectors.ts
// Não esquecer dos comentários explicativos, para contextualizar a lógica e as decisões de design, especialmente em relação à presença online e à integração com o PresenceService. Isso ajuda a evitar confusões futuras sobre onde e como o status online deve ser controlado e lido, e reforça a ideia de que o estado online é derivado do Firestore, sem "simulações" em outros lugares (ex: Auth).
// O selector selectGlobalOnlineUsers filtra os usuários online com base no array de online users do
// Firestore, e não tenta "simular" o status online com base em outros dados.
// Ele também garante que o usuário atual (meUid) seja excluído da lista de online users,
// para evitar confusões sobre o próprio status online do usuário autenticado.
import { createSelector } from '@ngrx/store';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { selectUsersMap, selectOnlineUsers } from './user.selectors';
import { selectAuthUid } from './auth.selectors';

/**
 * Fonte de verdade:
 * - "online" deriva do PresenceService/Firestore (selectOnlineUsers).
 * - Este selector NÃO deve inferir online via usersMap nem injetar isOnline=true.
 * - Faz apenas o "join" para obter dados completos quando disponíveis.
 */
export const selectGlobalOnlineUsers = createSelector(
  selectOnlineUsers,
  selectUsersMap,
  selectAuthUid,
  (onlineArr, usersMap, meUid): IUserDados[] => {
    const list = onlineArr ?? [];
    const seen = new Set<string>();
    const out: IUserDados[] = [];

    for (const item of list) {
      const uid = item?.uid;
      if (!uid) continue;
      if (uid === meUid) continue;

      // se vier duplicado do backend/store, evita duplicar no VM
      if (seen.has(uid)) continue;
      seen.add(uid);

      // prioridade: dados completos do usersMap
      const full = usersMap?.[uid];
      if (full?.uid) {
        out.push(full);
        continue;
      }

      // fallback: mantém o item da presença (não é "injeção", é dado do Firestore)
      out.push(item as IUserDados);
    }

    return out;
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

