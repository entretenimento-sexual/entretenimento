import { isStructuralProfileTypeChange } from './profile-identity-change.policy';

const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export interface ProfileIdentityReviewCursor {
  requestedAt: number;
  uid: string;
}

export interface ProfileIdentityReviewItem {
  uid: string;
  currentIdentityCode: string;
  requestedIdentityCode: string;
  requestedAt: number;
  status: 'PENDING';
  structuralChange: boolean;
}

export function projectIdentityReviewItem(
  uid: string, data: Record<string, unknown>
): ProfileIdentityReviewItem | null {
  const from = String(data['currentIdentityCode'] ?? '').trim().toLowerCase();
  const to = String(data['requestedIdentityCode'] ?? '').trim().toLowerCase();
  const requestedAt = Number(data['requestedAt']);
  if (!UID_PATTERN.test(uid) || data['status'] !== 'PENDING' ||
      !from || !to || !Number.isSafeInteger(requestedAt) || requestedAt <= 0) {
    return null;
  }
  return {
    uid, currentIdentityCode: from, requestedIdentityCode: to, requestedAt,
    status: 'PENDING',
    structuralChange: isStructuralProfileTypeChange(from, to),
  };
}

export function parseProfileIdentityCursor(value: unknown): ProfileIdentityReviewCursor | null {
  if (value == null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const cursor = value as Record<string, unknown>;
  if (!Number.isSafeInteger(cursor['requestedAt']) ||
      Number(cursor['requestedAt']) <= 0 ||
      typeof cursor['uid'] !== 'string' || !UID_PATTERN.test(cursor['uid'])) {
    return null;
  }
  return { requestedAt: Number(cursor['requestedAt']), uid: String(cursor['uid']) };
}
