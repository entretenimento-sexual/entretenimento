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
 * Observação arquitetural:
 * - onlineUsers = coleção presence (efêmera)
 * - usersMap = perfis persistentes
 * - este selector faz o JOIN entre as duas camadas
 *
 * Regra:
 * - nunca inferir "online" fora do fluxo de presença
 * - nunca usar onlineUsers para sobrescrever o usersMap no reducer
 */

function mergeProfileWithPresence(
  profile: IUserDados | null | undefined,
  presence: IUserDados | null | undefined
): IUserDados | null {
  if (!profile && !presence) return null;
  if (!profile) return presence ?? null;
  if (!presence) return profile ?? null;

  return {
    ...profile,
    ...presence,

    // uid canônico preservado
    uid: presence.uid || profile.uid,

    // prioridade explícita para campos de presença
    isOnline: (presence as any)?.isOnline ?? (profile as any)?.isOnline,
    lastSeen: (presence as any)?.lastSeen ?? (profile as any)?.lastSeen,
    lastOnlineAt: (presence as any)?.lastOnlineAt ?? (profile as any)?.lastOnlineAt,
    lastOfflineAt: (presence as any)?.lastOfflineAt ?? (profile as any)?.lastOfflineAt,
    lastStateChangeAt:
      (presence as any)?.lastStateChangeAt ?? (profile as any)?.lastStateChangeAt,
    presenceState:
      (presence as any)?.presenceState ?? (profile as any)?.presenceState,
  } as IUserDados;
}

/**
 * Regra de exposição do produto:
 * - preferimos o perfil persistente quando ele existir
 * - se não houver perfil persistente, não “inventamos” elegibilidade premium/profile
 * - isso evita expor usuários com base apenas em doc efêmero de presença
 */
function canExposeUser(
  merged: IUserDados | null | undefined,
  profile: IUserDados | null | undefined
): boolean {
  if (!merged?.uid) return false;

  const anyMerged = merged as any;
  const anyProfile = profile as any;

  // opt-out futuro
  if (anyMerged?.hideFromOnline === true) return false;

  // se temos perfil persistente, aplicamos regra mais rica
  if (profile) {
    const profileCompleted = anyProfile?.profileCompleted === true;

    const hasMinFields =
      typeof anyProfile?.gender === 'string' &&
      anyProfile.gender.trim() !== '' &&
      typeof anyProfile?.estado === 'string' &&
      anyProfile.estado.trim() !== '' &&
      typeof anyProfile?.municipio === 'string' &&
      anyProfile.municipio.trim() !== '';

    // quando explicitamente false, não expõe
    if (anyProfile?.emailVerified === false) return false;

    return profileCompleted || hasMinFields;
  }

  /**
   * Fallback sem perfil persistente:
   * - aceitamos apenas presença com dados mínimos de exibição
   * - isso evita cards “fantasma” só com uid
   */
  const hasDisplayData =
    (typeof anyMerged?.nickname === 'string' && anyMerged.nickname.trim() !== '') ||
    (typeof anyMerged?.photoURL === 'string' && anyMerged.photoURL.trim() !== '');

  return hasDisplayData;
}

export const selectGlobalOnlineUsers = createSelector(
  selectOnlineUsers,
  selectUsersMap,
  selectAuthUid,
  (onlineArr, usersMap, meUid): IUserDados[] => {
    const list = onlineArr ?? [];
    const seen = new Set<string>();
    const out: IUserDados[] = [];

    for (const presenceItem of list) {
      const uid = presenceItem?.uid;
      if (!uid) continue;
      if (uid === meUid) continue;

      if (seen.has(uid)) continue;
      seen.add(uid);

      const profile = usersMap?.[uid] ?? null;
      const merged = mergeProfileWithPresence(profile, presenceItem);

      if (!canExposeUser(merged, profile)) continue;

      out.push(merged as IUserDados);
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
//logout() tem service especifico e só limpa sessão (AuthSession), não mexe no estado do perfil (CurrentUserStore) para evitar "flash de guest" e manter dados degradados quando possível
//observeUserChanges() é controlado por AuthSessionSyncEffects, que é acionado por mudanças no UID da sessão (login/logout/token expirou) e mantém o perfil do usuário atual atualizado em tempo real, sem precisar ser chamado diretamente por componentes ou outros efeitos.
//O estado online do usuário é controlado exclusivamente pelo PresenceService e refletido no Firestore, e o selector selectGlobalOnlineUsers lê esse estado diretamente do Firestore, sem tentar "simular" online/offline com base em outros dados (ex: usersMap).
// ainda está sendo usado em alguns lugares e precisa ser migrado.
Ferramentas de debug ajudam bastante
É assim que funcionam as grandes plataformas?
Compatibilizar o estado online do usuário com o presence.service e aproximar do funcionamento ideal
*/

