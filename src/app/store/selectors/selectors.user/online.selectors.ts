// src/app/store/selectors/selectors.user/online.selectors.ts
// -----------------------------------------------------------------------------
// SELECTORS DE USUÁRIOS ONLINE
// -----------------------------------------------------------------------------
// Este selector materializa perfil público + presença. Preferências, distância,
// compatibilidade e ranking pertencem exclusivamente ao
// DiscoveryCardEnrichmentService.
// -----------------------------------------------------------------------------

import { createSelector } from '@ngrx/store';
import type { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { selectOnlineUsers, selectUsersMap } from './user.selectors';
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
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readValue<T = unknown>(
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>,
  keys: readonly string[]
): T | null {
  for (const source of [primary, fallback]) {
    for (const key of keys) {
      const value = source[key];
      if (value !== undefined && value !== null) return value as T;
    }
  }
  return null;
}

function readText(
  primary: Record<string, unknown>,
  fallback: Record<string, unknown>,
  keys: readonly string[]
): string | null {
  for (const source of [primary, fallback]) {
    for (const key of keys) {
      const value = toText(source[key]);
      if (value) return value;
    }
  }
  return null;
}

function buildOnlinePublicProfile(
  onlineItem: IUserDados | null | undefined,
  storedProfile: IUserDados | null | undefined
): IUserDados | null {
  if (!onlineItem && !storedProfile) return null;

  const online = (onlineItem ?? {}) as IUserDados & Record<string, unknown>;
  const stored = (storedProfile ?? {}) as IUserDados & Record<string, unknown>;
  const uid = readText(online, stored, ['uid']);
  if (!uid) return null;

  return {
    ...(storedProfile ?? {}),
    ...(onlineItem ?? {}),
    uid,
    nickname: readText(online, stored, ['nickname']),
    nicknameNormalized: readText(online, stored, ['nicknameNormalized']),
    photoURL: readText(online, stored, ['photoURL', 'photoUrl', 'avatarUrl']),
    gender: readText(online, stored, ['gender', 'genero']) ?? undefined,
    orientation: readText(online, stored, [
      'orientation', 'sexualOrientation', 'orientacao', 'orientacaoSexual',
    ]) ?? undefined,
    age: readValue<number>(online, stored, ['age', 'idade']),
    normalizedGender: readText(online, stored, ['normalizedGender']),
    normalizedOrientation: readText(online, stored, ['normalizedOrientation']),
    interestedInGenders: readValue(online, stored, ['interestedInGenders']),
    interestedInOrientations: readValue(online, stored, ['interestedInOrientations']),
    compatibilityReady: readValue<boolean>(online, stored, ['compatibilityReady']),
    publicRelationshipIntents: readValue(online, stored, ['publicRelationshipIntents']),
    publicSexualPractices: readValue(online, stored, ['publicSexualPractices']),
    publicBodyTraits: readValue(online, stored, ['publicBodyTraits']),
    preferenceBadgesVisible: readValue<boolean>(online, stored, ['preferenceBadgesVisible']),
    publicPreferencesUpdatedAt: readValue<number>(online, stored, ['publicPreferencesUpdatedAt']),
    estado: readText(online, stored, ['estado', 'uf', 'state']) ?? undefined,
    municipio: readText(online, stored, ['municipio', 'cidade', 'city']) ?? undefined,
    role: (readText(online, stored, ['role']) ?? 'free') as IUserDados['role'],
    latitude: readValue<number>(online, stored, ['latitude']) ?? undefined,
    longitude: readValue<number>(online, stored, ['longitude']) ?? undefined,
    geohash: readText(online, stored, ['geohash']) ?? undefined,
    createdAt: readValue<number>(stored, online, ['createdAt']),
    updatedAt: readValue<number>(online, stored, ['updatedAt']),
    isOnline: readValue<boolean>(online, stored, ['isOnline']) === true,
    lastSeen: readValue<number>(online, stored, ['lastSeen']),
    lastOnlineAt: readValue<number>(online, stored, ['lastOnlineAt']),
    lastOfflineAt: readValue<number>(online, stored, ['lastOfflineAt']),
    hideFromOnline: readValue<boolean>(online, stored, ['hideFromOnline']) === true,
  } as IUserDados;
}

function getOnlineRejectionReason(
  profile: IUserDados | null,
  meUid: string | null,
  seen: Set<string>
): OnlineRejectionReason | null {
  const uid = toText(profile?.uid);
  if (!uid) return 'missing_uid';
  if (meUid && uid === meUid) return 'current_user';
  if (seen.has(uid)) return 'duplicated_uid';
  if (!profile) return 'missing_public_profile';
  if ((profile as IUserDados & { hideFromOnline?: boolean }).hideFromOnline === true) {
    return 'hidden_from_online';
  }
  if (!toText(profile.nickname)) return 'missing_nickname';
  if (profile.isOnline !== true) return 'not_online';
  return null;
}

function buildDebug(
  profile: IUserDados | null,
  reason: OnlineRejectionReason | null
): OnlineCandidateDebug {
  return {
    uid: toText(profile?.uid),
    nickname: toText(profile?.nickname),
    isOnline: typeof profile?.isOnline === 'boolean' ? profile.isOnline : null,
    gender: profile?.gender,
    estado: profile?.estado,
    municipio: profile?.municipio,
    rejectionReason: reason,
  };
}

function materialize(
  onlineArr: readonly IUserDados[] | null | undefined,
  usersMap: Record<string, IUserDados> | null | undefined,
  meUid: string | null | undefined
): { profiles: IUserDados[]; debug: OnlineCandidateDebug[] } {
  const seen = new Set<string>();
  const profiles: IUserDados[] = [];
  const debug: OnlineCandidateDebug[] = [];

  for (const onlineItem of onlineArr ?? []) {
    const uid = toText(onlineItem?.uid);
    const profile = buildOnlinePublicProfile(
      onlineItem,
      uid ? usersMap?.[uid] ?? null : null
    );
    const reason = getOnlineRejectionReason(profile, meUid ?? null, seen);
    if (uid) seen.add(uid);
    debug.push(buildDebug(profile, reason));
    if (reason === null && profile) profiles.push(profile);
  }

  return { profiles, debug };
}

export const selectGlobalOnlineUsersDebug = createSelector(
  selectOnlineUsers,
  selectUsersMap,
  selectAuthUid,
  (onlineArr, usersMap, meUid): OnlineCandidateDebug[] =>
    materialize(onlineArr, usersMap, meUid).debug
);

export const selectGlobalOnlineUsers = createSelector(
  selectOnlineUsers,
  selectUsersMap,
  selectAuthUid,
  (onlineArr, usersMap, meUid): IUserDados[] =>
    materialize(onlineArr, usersMap, meUid).profiles
);

export const selectGlobalOnlineCount = createSelector(
  selectGlobalOnlineUsers,
  (list) => list.length
);
