// functions/src/promotion-boost/photo-promotion-target.policy.ts
import {
  isCurrentPublicMediaProjectionExposure,
} from '../media/application/public-media-exposure.policy';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : {};
}

function timestampMillis(value: unknown): number | null {
  if (
    value
    && typeof value === 'object'
    && typeof (value as { toMillis?: unknown }).toMillis === 'function'
  ) {
    try {
      const parsed = (value as { toMillis: () => number }).toMillis();
      return Number.isFinite(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.trunc(parsed)
    : null;
}

export function isPhotoPromotionPublicationEligible(
  raw: unknown
): boolean {
  const source = asRecord(raw);
  return source['isPublished'] === true
    && String(source['visibility'] ?? '').toUpperCase() === 'PUBLIC'
    && source['moderationStatus'] === 'APPROVED';
}

export function isPhotoPromotionPublicProjectionEligible(
  raw: unknown,
  nowMs: number
): boolean {
  return isCurrentPublicMediaProjectionExposure(
    asRecord(raw),
    nowMs,
    ['PUBLIC']
  );
}

export function isPhotoPromotionTargetEligible(input: {
  readonly ownerUid: string;
  readonly photoId: string;
  readonly publication: unknown;
  readonly publicPhoto: unknown;
  readonly nowMs: number;
}): boolean {
  const publication = asRecord(input.publication);
  const publicPhoto = asRecord(input.publicPhoto);

  return publication['ownerUid'] === input.ownerUid
    && publication['photoId'] === input.photoId
    && publicPhoto['ownerUid'] === input.ownerUid
    && publicPhoto['id'] === input.photoId
    && isPhotoPromotionPublicationEligible(publication)
    && isPhotoPromotionPublicProjectionEligible(publicPhoto, input.nowMs);
}

export function photoPublicationEligibilityChanged(
  before: unknown,
  after: unknown
): boolean {
  const left = asRecord(before);
  const right = asRecord(after);

  return left['isPublished'] !== right['isPublished']
    || left['visibility'] !== right['visibility']
    || left['moderationStatus'] !== right['moderationStatus'];
}

export function publicPhotoPromotionEligibilityChanged(
  before: unknown,
  after: unknown
): boolean {
  const left = asRecord(before);
  const right = asRecord(after);

  return left['visibility'] !== right['visibility']
    || left['moderationStatus'] !== right['moderationStatus']
    || left['ageEligibilityVerifiedAdult']
      !== right['ageEligibilityVerifiedAdult']
    || timestampMillis(left['ageEligibilityValidUntil'])
      !== timestampMillis(right['ageEligibilityValidUntil']);
}

export function publicProfilePromotionEligibilityChanged(
  before: unknown,
  after: unknown
): boolean {
  const left = asRecord(before);
  const right = asRecord(after);

  return left['ageEligibilityVerifiedAdult']
      !== right['ageEligibilityVerifiedAdult']
    || left['ageEligibilityAdultAccessAllowed']
      !== right['ageEligibilityAdultAccessAllowed']
    || timestampMillis(left['ageEligibilityValidUntil'])
      !== timestampMillis(right['ageEligibilityValidUntil']);
}

export function advertiserInteractionFieldsChanged(
  before: unknown,
  after: unknown
): boolean {
  const left = asRecord(before);
  const right = asRecord(after);
  const leftHold = asRecord(left['moderationAutomationHold']);
  const rightHold = asRecord(right['moderationAutomationHold']);
  const leftAge = asRecord(left['ageReverification']);
  const rightAge = asRecord(right['ageReverification']);
  const leftTerms = asRecord(left['acceptedTerms']);
  const rightTerms = asRecord(right['acceptedTerms']);
  const leftConsent = asRecord(left['adultConsent']);
  const rightConsent = asRecord(right['adultConsent']);

  return left['accountStatus'] !== right['accountStatus']
    || left['suspended'] !== right['suspended']
    || left['interactionBlocked'] !== right['interactionBlocked']
    || leftHold['active'] !== rightHold['active']
    || leftHold['expiresAtMs'] !== rightHold['expiresAtMs']
    || leftAge['status'] !== rightAge['status']
    || leftTerms['accepted'] !== rightTerms['accepted']
    || leftTerms['version'] !== rightTerms['version']
    || leftTerms['acknowledgedPrivacyNotice']
      !== rightTerms['acknowledgedPrivacyNotice']
    || leftConsent['accepted'] !== rightConsent['accepted']
    || leftConsent['version'] !== rightConsent['version'];
}
