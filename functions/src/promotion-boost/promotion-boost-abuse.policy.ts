// functions/src/promotion-boost/promotion-boost-abuse.policy.ts
// -----------------------------------------------------------------------------
// PROMOTION / BOOST COMMERCIAL ABUSE POLICY
// -----------------------------------------------------------------------------
// Promotion compra placement publicitário. Não existe wallet, saldo transferível,
// saque, payout ou transferência peer-to-peer neste domínio.
// -----------------------------------------------------------------------------

export const PROMOTION_BOOST_CAMPAIGN_MUTATION_RATE_LIMIT = Object.freeze({
  burstWindowMs: 60_000,
  burstMax: 8,
  sustainedWindowMs: 60 * 60_000,
  sustainedMax: 40,
});

export const PROMOTION_BOOST_EVENT_RATE_LIMIT = Object.freeze({
  burstWindowMs: 60_000,
  burstMax: 30,
  sustainedWindowMs: 60 * 60_000,
  sustainedMax: 180,
});

export const PROMOTION_BOOST_MIN_CLICK_DELAY_MS = 250;
export const PROMOTION_BOOST_MIN_QUALIFIED_EXPOSURE_DELAY_MS = 750;
export const PROMOTION_BOOST_FRAUD_SIGNAL_TTL_MS =
  30 * 24 * 60 * 60 * 1_000;

export type PromotionBoostFraudSignalReason =
  | 'self_interaction'
  | 'event_too_fast'
  | 'placement_identity_mismatch'
  | 'event_velocity_exceeded';

export function isPromotionBoostSelfInteraction(input: {
  readonly viewerUid: string;
  readonly advertiserUid: string;
  readonly targetOwnerUid: string;
}): boolean {
  return input.viewerUid === input.advertiserUid
    || input.viewerUid === input.targetOwnerUid;
}

export function isPromotionBoostEventTimingPlausible(input: {
  readonly event: 'qualified_exposure' | 'click';
  readonly deliveredAt: number;
  readonly now: number;
}): boolean {
  const elapsed = input.now - input.deliveredAt;

  if (!Number.isFinite(elapsed) || elapsed < 0) return false;

  return input.event === 'qualified_exposure'
    ? elapsed >= PROMOTION_BOOST_MIN_QUALIFIED_EXPOSURE_DELAY_MS
    : elapsed >= PROMOTION_BOOST_MIN_CLICK_DELAY_MS;
}
