// src/app/store/selectors/selectors.user/online.selectors.ts
// -----------------------------------------------------------------------------
// Selectors de usuários online
// -----------------------------------------------------------------------------
//
// Fonte de verdade:
// - presence/{uid}: define estado efêmero de presença;
// - public_profiles/{uid}: define o perfil público exibível;
// - onlineUsers: lista materializada pelo OnlineUsersEffects;
// - usersMap: cache local de perfis públicos.
//
// Regra deste selector:
// - Online NÃO deve consultar Firestore;
// - Online NÃO deve inferir presença por Auth;
// - Online NÃO deve expor dados privados;
// - Online deve exibir perfis públicos que estejam efetivamente online;
// - presence sozinho não basta;
// - perfil público sem nickname não entra;
// - estado/município/gênero enriquecem o card, mas não bloqueiam o modo Online.
//
// Motivo da mudança:
// - o effect já entrega actionUsersTotal: 1 e rawOnlineTotal: 1;
// - o selector anterior ainda zerava globalOnlineTotal;
// - a rejeição estava rígida demais para o modo Online.

import { createSelector } from '@ngrx/store';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';

import {
  selectOnlineUsers,
  selectUsersMap,
} from './user.selectors';

import { selectAuthUid } from './auth.selectors';

type OnlineRejectionReason =
  | 'missing_uid'
  | 'current_user'
  | 'duplicated_uid'
  | 'missing_public_profile'
  | 'missing_nickname'
  | 'hidden_from_online'
  | 'not_online';

export interface OnlineCandidateDebug {
  uid: string | null;
  nickname: string | null;
  isOnline: boolean | null;
  gender: unknown;
  estado: unknown;
  municipio: unknown;
  rejectionReason: OnlineRejectionReason | null;
}

function toText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const text = value.trim();

  return text.length ? text : null;
}

function toBooleanTrue(value: unknown): boolean {
  return value === true;
}

function sameUid(a: unknown, b: unknown): boolean {
  const uidA = toText(a);
  const uidB = toText(b);

  return !!uidA && !!uidB && uidA === uidB;
}

/**
 * Lê campo textual aceitando aliases comuns.
 *
 * Isso protege contra pequenas diferenças entre:
 * - public_profiles;
 * - IUserDados;
 * - documentos antigos;
 * - dados vindos de migrações anteriores.
 */
function readFirstText(source: any, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = toText(source?.[key]);

    if (value) {
      return value;
    }
  }

  return null;
}

function readFirstValue<T = unknown>(
  source: any,
  keys: readonly string[]
): T | null {
  for (const key of keys) {
    const value = source?.[key];

    if (value !== undefined && value !== null) {
      return value as T;
    }
  }

  return null;
}

/**
 * Monta um perfil público normalizado usando:
 * - onlineItem como fonte principal, porque ele já vem hidratado pelo effect;
 * - storedProfile como fallback, porque pode conter cache útil.
 *
 * Importante:
 * - não espalhamos presence cru por cima de tudo;
 * - só copiamos campos públicos/efêmeros conhecidos;
 * - não entram e-mail, telefone ou dados privados.
 */
function buildOnlinePublicProfile(
  onlineItem: IUserDados | null | undefined,
  storedProfile: IUserDados | null | undefined
): IUserDados | null {
  if (!onlineItem && !storedProfile) {
    return null;
  }

  const online = onlineItem as any;
  const stored = storedProfile as any;

  const uid =
    readFirstText(online, ['uid']) ??
    readFirstText(stored, ['uid']);

  if (!uid) {
    return null;
  }

  return {
    ...(storedProfile ?? {}),
    ...(onlineItem ?? {}),

    uid,

    nickname:
      readFirstText(online, ['nickname']) ??
      readFirstText(stored, ['nickname']),

    nicknameNormalized:
      readFirstText(online, ['nicknameNormalized']) ??
      readFirstText(stored, ['nicknameNormalized']),

    photoURL:
      readFirstText(online, ['photoURL', 'photoUrl', 'avatarUrl']) ??
      readFirstText(stored, ['photoURL', 'photoUrl', 'avatarUrl']),

    gender:
      readFirstText(online, ['gender']) ??
      readFirstText(stored, ['gender']),

    orientation:
      readFirstText(online, [
        'orientation',
        'sexualOrientation',
        'orientacao',
        'orientacaoSexual',
      ]) ??
      readFirstText(stored, [
        'orientation',
        'sexualOrientation',
        'orientacao',
        'orientacaoSexual',
      ]),

    estado:
      readFirstText(online, ['estado', 'uf', 'state']) ??
      readFirstText(stored, ['estado', 'uf', 'state']),

    municipio:
      readFirstText(online, ['municipio', 'cidade', 'city']) ??
      readFirstText(stored, ['municipio', 'cidade', 'city']),

    role:
      readFirstText(online, ['role']) ??
      readFirstText(stored, ['role']) ??
      'free',

    latitude:
      readFirstValue(online, ['latitude']) ??
      readFirstValue(stored, ['latitude']),

    longitude:
      readFirstValue(online, ['longitude']) ??
      readFirstValue(stored, ['longitude']),

    geohash:
      readFirstText(online, ['geohash']) ??
      readFirstText(stored, ['geohash']),

    createdAt:
      readFirstValue(stored, ['createdAt']) ??
      readFirstValue(online, ['createdAt']),

    updatedAt:
      readFirstValue(online, ['updatedAt']) ??
      readFirstValue(stored, ['updatedAt']),

    /**
     * Campos de presença.
     * Aqui o online é explícito: não inferimos por lastSeen.
     */
    isOnline:
      readFirstValue<boolean>(online, ['isOnline']) ??
      readFirstValue<boolean>(stored, ['isOnline']) ??
      false,

    lastSeen:
      readFirstValue(online, ['lastSeen']) ??
      readFirstValue(stored, ['lastSeen']),

    lastOnlineAt:
      readFirstValue(online, ['lastOnlineAt']) ??
      readFirstValue(stored, ['lastOnlineAt']),

    lastOfflineAt:
      readFirstValue(online, ['lastOfflineAt']) ??
      readFirstValue(stored, ['lastOfflineAt']),

    lastStateChangeAt:
      readFirstValue(online, ['lastStateChangeAt']) ??
      readFirstValue(stored, ['lastStateChangeAt']),

    presenceState:
      readFirstText(online, ['presenceState']) ??
      readFirstText(stored, ['presenceState']),

    presenceSessionId:
      readFirstText(online, ['presenceSessionId']) ??
      readFirstText(stored, ['presenceSessionId']),

    hideFromOnline:
      readFirstValue<boolean>(online, ['hideFromOnline']) ??
      readFirstValue<boolean>(stored, ['hideFromOnline']) ??
      false,
  } as IUserDados;
}

/**
 * Regra final de exposição do modo Online.
 *
 * Segurança:
 * - exige uid;
 * - exige nickname público;
 * - exige isOnline true;
 * - respeita hideFromOnline;
 * - bloqueia o próprio usuário.
 *
 * Não bloqueia por falta de cidade/gênero, porque isso é qualidade de perfil,
 * não requisito de presença online.
 */
function getOnlineRejectionReason(
  profile: IUserDados | null,
  meUid: string | null,
  seen: Set<string>
): OnlineRejectionReason | null {
  const uid = toText(profile?.uid);

  if (!uid) {
    return 'missing_uid';
  }

  if (sameUid(uid, meUid)) {
    return 'current_user';
  }

  if (seen.has(uid)) {
    return 'duplicated_uid';
  }

  if (!profile) {
    return 'missing_public_profile';
  }

  if ((profile as any).hideFromOnline === true) {
    return 'hidden_from_online';
  }

  if (!toText((profile as any).nickname)) {
    return 'missing_nickname';
  }

  if (!toBooleanTrue((profile as any).isOnline)) {
    return 'not_online';
  }

  return null;
}

function toDebugItem(
  profile: IUserDados | null,
  rejectionReason: OnlineRejectionReason | null
): OnlineCandidateDebug {
  const anyProfile = profile as any;

  return {
    uid: toText(anyProfile?.uid),
    nickname: toText(anyProfile?.nickname),
    isOnline:
      typeof anyProfile?.isOnline === 'boolean'
        ? anyProfile.isOnline
        : null,
    gender: anyProfile?.gender,
    estado: anyProfile?.estado,
    municipio: anyProfile?.municipio,
    rejectionReason,
  };
}

/**
 * Debug puro para inspeção via Store DevTools ou logs temporários.
 *
 * Não usar diretamente no template final.
 */
export const selectGlobalOnlineUsersDebug = createSelector(
  selectOnlineUsers,
  selectUsersMap,
  selectAuthUid,
  (onlineArr, usersMap, meUid): OnlineCandidateDebug[] => {
    const list = Array.isArray(onlineArr) ? onlineArr : [];
    const seen = new Set<string>();
    const debug: OnlineCandidateDebug[] = [];

    for (const onlineItem of list) {
      const uid = toText(onlineItem?.uid);
      const storedProfile = uid ? usersMap?.[uid] ?? null : null;

      const profile = buildOnlinePublicProfile(
        onlineItem,
        storedProfile
      );

      const rejectionReason = getOnlineRejectionReason(
        profile,
        meUid ?? null,
        seen
      );

      if (uid && !seen.has(uid)) {
        seen.add(uid);
      }

      debug.push(toDebugItem(profile, rejectionReason));
    }

    return debug;
  }
);

/**
 * Lista global de usuários online exibíveis.
 */
export const selectGlobalOnlineUsers = createSelector(
  selectOnlineUsers,
  selectUsersMap,
  selectAuthUid,
  (onlineArr, usersMap, meUid): IUserDados[] => {
    const list = Array.isArray(onlineArr) ? onlineArr : [];
    const seen = new Set<string>();
    const out: IUserDados[] = [];

    for (const onlineItem of list) {
      const uid = toText(onlineItem?.uid);
      const storedProfile = uid ? usersMap?.[uid] ?? null : null;

      const profile = buildOnlinePublicProfile(
        onlineItem,
        storedProfile
      );

      const rejectionReason = getOnlineRejectionReason(
        profile,
        meUid ?? null,
        seen
      );

      if (uid && !seen.has(uid)) {
        seen.add(uid);
      }

      if (rejectionReason !== null) {
        continue;
      }

      out.push(profile as IUserDados);
    }

    return out;
  }
);

export const selectGlobalOnlineCount = createSelector(
  selectGlobalOnlineUsers,
  (list) => list.length
);