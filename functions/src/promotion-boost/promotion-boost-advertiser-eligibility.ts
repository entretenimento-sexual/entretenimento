// functions/src/promotion-boost/promotion-boost-advertiser-eligibility.ts
import {
  assertInteractionAccessData,
} from '../account_lifecycle/interaction-access.policy';

export function isPromotionBoostAdvertiserInteractionEligible(input: {
  readonly rawUser: unknown;
  readonly rawAgeEligibility: unknown;
  readonly advertiserUid: string;
}): boolean {
  try {
    assertInteractionAccessData(
      input.rawUser as Parameters<typeof assertInteractionAccessData>[0],
      input.rawAgeEligibility,
      input.advertiserUid
    );
    return true;
  } catch {
    return false;
  }
}
