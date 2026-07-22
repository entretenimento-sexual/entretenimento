import {
  IUserAdultConsent,
  IUserAgeReverification,
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
  if (!source || typeof source !== 'object') return null;

  return {
    accepted: source.accepted === true,
    version: String(source.version ?? '').trim(),
    acceptedAt: toSerializableEpoch(source.acceptedAt),
    updatedAt: toSerializableEpoch(source.updatedAt),
    source: String(source.source ?? '').trim() || null,
  };
}

function sanitizeAgeReverification(
  value: unknown
): IUserAgeReverification | null {
  const source = value as any;
  if (!source || typeof source !== 'object') return null;

  const status = String(source.status ?? '').trim().toUpperCase();
  if (![
    'NONE',
    'REQUIRED',
    'SUBMITTED',
    'UNDER_REVIEW',
    'VERIFIED',
    'REJECTED',
    'EXPIRED',
  ].includes(status)) {
    return null;
  }

  const result = String(source.result ?? '').trim().toUpperCase();
  const declaredAgeBand = String(source.declaredAgeBand ?? '')
    .trim()
    .toUpperCase();

  return {
    status: status as IUserAgeReverification['status'],
    caseId: String(source.caseId ?? '').trim() || null,
    reportId: String(source.reportId ?? '').trim() || null,
    source: source.source === 'MINOR_SAFETY_PROFILE_REPORT'
      ? 'MINOR_SAFETY_PROFILE_REPORT'
      : null,
    requestedAt: toSerializableEpoch(source.requestedAt),
    dueAt: toSerializableEpoch(source.dueAt),
    submittedAt: toSerializableEpoch(source.submittedAt),
    reviewedAt: toSerializableEpoch(source.reviewedAt),
    reviewedBy: String(source.reviewedBy ?? '').trim() || null,
    result: ['ADULT', 'INCONCLUSIVE', 'UNDERAGE'].includes(result)
      ? result as IUserAgeReverification['result']
      : null,
    method: [
      'SELF_DECLARATION_REVIEW',
      'EXTERNAL_PROVIDER',
      'MANUAL_REVIEW',
    ].includes(String(source.method ?? '').trim().toUpperCase())
      ? String(source.method).trim().toUpperCase() as IUserAgeReverification['method']
      : null,
    declaredAgeBand:
      declaredAgeBand === '18_PLUS' || declaredAgeBand === 'UNDER_18'
        ? declaredAgeBand as IUserAgeReverification['declaredAgeBand']
        : null,
    resolution: String(source.resolution ?? '').trim() || null,
  };
}

function sanitizeTermsAcceptance(
  value: unknown
): IUserTermsAcceptance | null {
  const source = value as any;
  if (!source || typeof source !== 'object') return null;

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
    registrationCompletedAt: toSerializableEpoch(anyU.registrationCompletedAt),
    ageReverificationRestrictedAt: toSerializableEpoch(
      anyU.ageReverificationRestrictedAt
    ),

    subscriptionStartedAt: toSerializableEpoch(anyU.subscriptionStartedAt),
    subscriptionEndsAt: toSerializableEpoch(anyU.subscriptionEndsAt),
    subscriptionExpires: toSerializableEpoch(anyU.subscriptionExpires),
    billingUpdatedAt: toSerializableEpoch(anyU.billingUpdatedAt),
    roomCreationSubscriptionExpires: toSerializableEpoch(
      anyU.roomCreationSubscriptionExpires
    ),
    singleRoomCreationRightExpires: toSerializableEpoch(
      anyU.singleRoomCreationRightExpires
    ),

    lastStateChangeAt: toSerializableEpoch(anyU.lastStateChangeAt),
    adultConsent: sanitizeConsent(anyU.adultConsent),
    ageReverification: sanitizeAgeReverification(anyU.ageReverification),
    acceptedTerms: sanitizeTermsAcceptance(anyU.acceptedTerms),
  } as IUserDados;
}

export function sanitizeUsersForStore(
  list: IUserDados[] | null | undefined
): IUserDados[] {
  return (list ?? []).map(sanitizeUserForStore);
}
