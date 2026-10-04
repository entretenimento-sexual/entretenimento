// functions/src/promotion-boost/promotion-boost-advertiser-eligibility.ts
import {
  assertPlatformAccountAccessData,
} from '../account_lifecycle/interaction-access.policy';

export function isPromotionBoostAdvertiserInteractionEligible(input: {
  readonly rawUser: unknown;
  readonly rawAgeEligibility: unknown;
  readonly advertiserUid: string;
}): boolean {
  try {
    assertPlatformAccountAccessData(
      input.rawUser as Parameters<typeof assertPlatformAccountAccessData>[0]
    );
    return true;
  } catch {
    return false;
  }
}
