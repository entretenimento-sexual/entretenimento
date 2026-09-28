import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  resolvePhotoPromotionAdvertiserAuthority,
} from './promotion-boost-commercial-authority';

function advertiser(uid = 'owner-1') {
  return {
    policyVersion: 1,
    advertiserUid: uid,
    active: true,
    billingMode: 'postpaid',
    currency: 'BRL',
    maxCampaignBudgetCents: 100_000,
    createdAt: 1,
    updatedAt: 2,
    updatedBy: 'system',
  };
}

describe('promotion-boost-commercial-authority', () => {
  it('exige advertiser ativo e dono do alvo de foto', () => {
    assert.ok(resolvePhotoPromotionAdvertiserAuthority({
      advertiserUid: 'owner-1',
      targetOwnerUid: 'owner-1',
      rawAdvertiserAccount: advertiser(),
    }));
  });

  it('nega anunciante sem autoridade sobre a foto', () => {
    assert.equal(resolvePhotoPromotionAdvertiserAuthority({
      advertiserUid: 'advertiser-1',
      targetOwnerUid: 'owner-1',
      rawAdvertiserAccount: advertiser('advertiser-1'),
    }), null);
  });

  it('nega conta anunciante inativa ou inválida', () => {
    assert.equal(resolvePhotoPromotionAdvertiserAuthority({
      advertiserUid: 'owner-1',
      targetOwnerUid: 'owner-1',
      rawAdvertiserAccount: {
        ...advertiser(),
        active: false,
      },
    }), null);
  });
});
