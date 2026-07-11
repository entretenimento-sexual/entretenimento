import {
  IUserAdultConsent,
  IUserDados,
  IUserTermsAcceptance,
} from 'src/app/core/interfaces/iuser-dados';
import { toEpoch } from '../../core/utils/epoch-utils';

export { toEpoch };

function toSerializableEpoch(value: unknown): number | null {
  const epoch = toEpoch(value as any);
  return typeof epoch === 'number' && Number.isFinite(epoch) ? epoch : null;
}

function sanitizeConsent(value: unknown): IUserAdultConsent | null {
  const source = value as any;

  if (!source || typeof source !== 'object') {
    return null;
  }

  return {
    accepted: source.accepted === true,
    version: String(source.version ?? '').trim(),
    acceptedAt: toSerializableEpoch(source.acceptedAt),
    updatedAt: toSerializableEpoch(source.updatedAt),
    source: String(source.source ?? '').trim() || null,
  };
}

function sanitizeTermsAcceptance(
  value: unknown
): IUserTermsAcceptance | null {
  const source = value as any;

  if (!source || typeof source !== 'object') {
    return null;
  }

  return {
    accepted: source.accepted === true,
    date: toSerializableEpoch(source.date),
    version: String(source.version ?? '').trim() || null,
    acceptedAt: toSerializableEpoch(source.acceptedAt),
    updatedAt: toSerializableEpoch(source.updatedAt),
    source: String(source.source ?? '').trim() || null,
  };
}

export function sanitizeUserForStore(u: IUserDados): IUserDados {
  if (!u) return u;
  const anyU = u as any;

  return {
    ...u,

    lastLogin: toSerializableEpoch(anyU.lastLogin) ?? 0,
    firstLogin: toSerializableEpoch(anyU.firstLogin),
    createdAt: toSerializableEpoch(anyU.createdAt),
    updatedAt: toSerializableEpoch(anyU.updatedAt),

    lastSeen: toSerializableEpoch(anyU.lastSeen),
    lastOnlineAt: toSerializableEpoch(anyU.lastOnlineAt),
    lastOfflineAt: toSerializableEpoch(anyU.lastOfflineAt),
    lastLocationAt: toSerializableEpoch(anyU.lastLocationAt),
    registrationDate: toSerializableEpoch(anyU.registrationDate),

    subscriptionExpires: toSerializableEpoch(anyU.subscriptionExpires),
    roomCreationSubscriptionExpires: toSerializableEpoch(anyU.roomCreationSubscriptionExpires),
    singleRoomCreationRightExpires: toSerializableEpoch(anyU.singleRoomCreationRightExpires),

    lastStateChangeAt: toSerializableEpoch(anyU.lastStateChangeAt),
    adultConsent: sanitizeConsent(anyU.adultConsent),
    acceptedTerms: sanitizeTermsAcceptance(anyU.acceptedTerms),
  } as IUserDados;
}

export function sanitizeUsersForStore(list: IUserDados[] | null | undefined): IUserDados[] {
  return (list ?? []).map(sanitizeUserForStore);
}
