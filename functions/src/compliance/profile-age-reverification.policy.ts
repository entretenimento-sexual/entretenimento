export const PROFILE_AGE_REVERIFICATION_DUE_DAYS = 7;
export const PROFILE_MINIMUM_AGE = 18;

export type ProfileAgeReverificationStatus =
  | 'NONE'
  | 'REQUIRED'
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'VERIFIED'
  | 'REJECTED'
  | 'EXPIRED';

export type ProfileAgeReverificationResult =
  | 'ADULT'
  | 'INCONCLUSIVE'
  | 'UNDERAGE';

export type ProfileAgeBand = '18_PLUS' | 'UNDER_18';

export function isProfileMinorSafetyReport(input: {
  targetType?: unknown;
  reason?: unknown;
}): boolean {
  return String(input.targetType ?? '').trim() === 'profile' &&
    String(input.reason ?? '').trim() === 'minor_safety';
}

export function isAgeReverificationAccessRestricted(
  status: unknown
): boolean {
  const normalized = String(status ?? '').trim().toUpperCase();

  return normalized === 'REQUIRED' ||
    normalized === 'SUBMITTED' ||
    normalized === 'UNDER_REVIEW' ||
    normalized === 'EXPIRED';
}

export function calculateAgeBand(
  birthDateIso: string,
  nowMs = Date.now()
): ProfileAgeBand | null {
  const normalized = String(birthDateIso ?? '').trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const birthDate = new Date(Date.UTC(year, month - 1, day));

  if (
    birthDate.getUTCFullYear() !== year ||
    birthDate.getUTCMonth() !== month - 1 ||
    birthDate.getUTCDate() !== day
  ) {
    return null;
  }

  const now = new Date(nowMs);

  if (!Number.isFinite(now.getTime()) || birthDate.getTime() > now.getTime()) {
    return null;
  }

  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const currentMonth = now.getUTCMonth();
  const currentDay = now.getUTCDate();
  const hasNotHadBirthday = currentMonth < birthDate.getUTCMonth() ||
    (currentMonth === birthDate.getUTCMonth() && currentDay < birthDate.getUTCDate());

  if (hasNotHadBirthday) {
    age -= 1;
  }

  if (age < 0 || age > 120) {
    return null;
  }

  return age >= PROFILE_MINIMUM_AGE ? '18_PLUS' : 'UNDER_18';
}

export function buildAgeReverificationDueAt(
  requestedAtMs: number,
  dueDays = PROFILE_AGE_REVERIFICATION_DUE_DAYS
): number {
  const safeRequestedAt = Number.isFinite(requestedAtMs)
    ? requestedAtMs
    : Date.now();
  const safeDays = Number.isFinite(dueDays) && dueDays > 0
    ? Math.floor(dueDays)
    : PROFILE_AGE_REVERIFICATION_DUE_DAYS;

  return safeRequestedAt + safeDays * 24 * 60 * 60 * 1000;
}
