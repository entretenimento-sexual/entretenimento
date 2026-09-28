import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PROMOTION_BOOST_MIN_CLICK_DELAY_MS,
  PROMOTION_BOOST_MIN_QUALIFIED_EXPOSURE_DELAY_MS,
  isPromotionBoostEventTimingPlausible,
  isPromotionBoostSelfInteraction,
} from './promotion-boost-abuse.policy';

describe('promotion-boost-abuse.policy', () => {
  it('bloqueia advertiser e owner como viewer do próprio placement', () => {
    assert.equal(isPromotionBoostSelfInteraction({
      viewerUid: 'advertiser',
      advertiserUid: 'advertiser',
      targetOwnerUid: 'owner',
    }), true);
    assert.equal(isPromotionBoostSelfInteraction({
      viewerUid: 'owner',
      advertiserUid: 'advertiser',
      targetOwnerUid: 'owner',
    }), true);
    assert.equal(isPromotionBoostSelfInteraction({
      viewerUid: 'viewer',
      advertiserUid: 'advertiser',
      targetOwnerUid: 'owner',
    }), false);
  });

  it('rejeita eventos rápidos demais para interação humana mínima', () => {
    const deliveredAt = 1_000_000;

    assert.equal(isPromotionBoostEventTimingPlausible({
      event: 'click',
      deliveredAt,
      now: deliveredAt + PROMOTION_BOOST_MIN_CLICK_DELAY_MS - 1,
    }), false);
    assert.equal(isPromotionBoostEventTimingPlausible({
      event: 'click',
      deliveredAt,
      now: deliveredAt + PROMOTION_BOOST_MIN_CLICK_DELAY_MS,
    }), true);

    assert.equal(isPromotionBoostEventTimingPlausible({
      event: 'qualified_exposure',
      deliveredAt,
      now:
        deliveredAt + PROMOTION_BOOST_MIN_QUALIFIED_EXPOSURE_DELAY_MS - 1,
    }), false);
  });
});
