import type {
  AgeReverificationStatus,
  IUserAgeReverification,
} from 'src/app/core/interfaces/iuser-dados';

export function normalizeAgeReverificationStatus(
  value: unknown
): AgeReverificationStatus {
  const status = String(value ?? '').trim().toUpperCase();

  switch (status) {
    case 'REQUIRED':
    case 'SUBMITTED':
    case 'UNDER_REVIEW':
    case 'VERIFIED':
    case 'REJECTED':
    case 'EXPIRED':
      return status;
    default:
      return 'NONE';
  }
}

export function isAgeReverificationAccessRestricted(
  value: IUserAgeReverification | null | undefined
): boolean {
  const status = normalizeAgeReverificationStatus(value?.status);

  return status === 'REQUIRED' ||
    status === 'SUBMITTED' ||
    status === 'UNDER_REVIEW' ||
    status === 'EXPIRED';
}
