//src\app\store\utils\user-store.serializer.ts
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { toEpoch } from '../../core/utils/epoch-utils';

export { toEpoch };

/** ✅ garante que Actions/Store nunca carreguem Timestamp */
export function sanitizeUserForStore(u: IUserDados): IUserDados {
  if (!u) return u;
  const anyU = u as any;

  return {
    ...u,
    lastLogin: toEpoch(anyU.lastLogin) ?? 0,
    firstLogin: toEpoch(anyU.firstLogin),
    createdAt: toEpoch(anyU.createdAt),
    updatedAt: toEpoch(anyU.updatedAt),

    lastSeen: toEpoch(anyU.lastSeen),
    lastOnlineAt: toEpoch(anyU.lastOnlineAt),
    lastOfflineAt: toEpoch(anyU.lastOfflineAt),
    lastLocationAt: toEpoch(anyU.lastLocationAt),
    registrationDate: toEpoch(anyU.registrationDate),

    subscriptionExpires: toEpoch(anyU.subscriptionExpires),
    roomCreationSubscriptionExpires: toEpoch(anyU.roomCreationSubscriptionExpires),
    singleRoomCreationRightExpires: toEpoch(anyU.singleRoomCreationRightExpires),

    // ✅ o seu campo crítico
    lastStateChangeAt: toEpoch(anyU.lastStateChangeAt),
  } as IUserDados;
}

export function sanitizeUsersForStore(list: IUserDados[] | null | undefined): IUserDados[] {
  return (list ?? []).map(sanitizeUserForStore);
}

