import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  advertiserInteractionFieldsChanged,
  isPhotoPromotionPublicProjectionEligible,
  photoPublicationEligibilityChanged,
  publicPhotoPromotionEligibilityChanged,
  publicProfilePromotionEligibilityChanged,
} from './photo-promotion-target.policy';

const NOW = 1_800_000_000_000;

function timestamp(value: number) {
  return { toMillis: () => value };
}

describe('photo promotion target policy', () => {
  it('ignora writes de métricas que não alteram elegibilidade', () => {
    assert.equal(
      photoPublicationEligibilityChanged(
        {
          isPublished: true,
          visibility: 'PUBLIC',
          moderationStatus: 'APPROVED',
          viewsCount: 10,
        },
        {
          isPublished: true,
          visibility: 'PUBLIC',
          moderationStatus: 'APPROVED',
          viewsCount: 11,
        }
      ),
      false
    );

    assert.equal(
      publicPhotoPromotionEligibilityChanged(
        {
          visibility: 'PUBLIC',
          moderationStatus: 'APPROVED',
          ageEligibilityVerifiedAdult: true,
          ageEligibilityValidUntil: timestamp(NOW + 60_000),
          viewsCount: 10,
        },
        {
          visibility: 'PUBLIC',
          moderationStatus: 'APPROVED',
          ageEligibilityVerifiedAdult: true,
          ageEligibilityValidUntil: timestamp(NOW + 60_000),
          viewsCount: 11,
        }
      ),
      false
    );
  });

  it('detecta mudanças que retiram eligibility da foto', () => {
    assert.equal(
      photoPublicationEligibilityChanged(
        {
          isPublished: true,
          visibility: 'PUBLIC',
          moderationStatus: 'APPROVED',
        },
        {
          isPublished: false,
          visibility: 'PUBLIC',
          moderationStatus: 'APPROVED',
        }
      ),
      true
    );

    assert.equal(
      publicPhotoPromotionEligibilityChanged(
        {
          visibility: 'PUBLIC',
          moderationStatus: 'APPROVED',
          ageEligibilityVerifiedAdult: true,
          ageEligibilityValidUntil: timestamp(NOW + 60_000),
        },
        {
          visibility: 'PRIVATE',
          moderationStatus: 'APPROVED',
          ageEligibilityVerifiedAdult: true,
          ageEligibilityValidUntil: timestamp(NOW + 60_000),
        }
      ),
      true
    );
  });

  it('falha fechado quando a projeção etária da foto expirou', () => {
    const base = {
      ownerUid: 'owner-1',
      id: 'photo-1',
      visibility: 'PUBLIC',
      moderationStatus: 'APPROVED',
      ageEligibilityVerifiedAdult: true,
    };

    assert.equal(
      isPhotoPromotionPublicProjectionEligible(
        {
          ...base,
          ageEligibilityValidUntil: timestamp(NOW + 1),
        },
        NOW
      ),
      true
    );

    assert.equal(
      isPhotoPromotionPublicProjectionEligible(
        {
          ...base,
          ageEligibilityValidUntil: timestamp(NOW),
        },
        NOW
      ),
      false
    );
  });

  it('ignora user writes fora do lifecycle de interação', () => {
    const base = {
      accountStatus: 'active',
      suspended: false,
      interactionBlocked: false,
      moderationAutomationHold: {
        active: false,
        expiresAtMs: 0,
      },
      ageReverification: { status: 'OK' },
      acceptedTerms: {
        accepted: true,
        version: 'v3',
        acknowledgedPrivacyNotice: true,
      },
      adultConsent: {
        accepted: true,
        version: 'v1',
      },
    };

    assert.equal(
      advertiserInteractionFieldsChanged(
        { ...base, nickname: 'Antes' },
        { ...base, nickname: 'Depois' }
      ),
      false
    );

    assert.equal(
      advertiserInteractionFieldsChanged(
        base,
        { ...base, suspended: true }
      ),
      true
    );
  });

  it('ignora métricas do perfil e detecta mudança de validade etária', () => {
    const before = {
      ageEligibilityVerifiedAdult: true,
      ageEligibilityAdultAccessAllowed: true,
      ageEligibilityValidUntil: timestamp(NOW + 60_000),
      viewsCount: 10,
    };

    assert.equal(
      publicProfilePromotionEligibilityChanged(
        before,
        { ...before, viewsCount: 11 }
      ),
      false
    );

    assert.equal(
      publicProfilePromotionEligibilityChanged(
        before,
        {
          ...before,
          ageEligibilityValidUntil: timestamp(NOW + 30_000),
        }
      ),
      true
    );
  });
});
