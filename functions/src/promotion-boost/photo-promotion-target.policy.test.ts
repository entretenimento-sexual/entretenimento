import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  advertiserInteractionFieldsChanged,
  isPhotoPromotionPublicProjectionEligible,
  photoPublicationEligibilityChanged,
} from './photo-promotion-target.policy';

const NOW = 1_800_000_000_000;

function timestamp(value: number) {
  return { toMillis: () => value };
}

describe('photo promotion target policy', () => {
  it('ignora writes de publicação que não alteram elegibilidade', () => {
    assert.equal(
      photoPublicationEligibilityChanged(
        {
          isPublished: true,
          visibility: 'PUBLIC',
          moderationStatus: 'APPROVED',
          updatedAt: 1,
        },
        {
          isPublished: true,
          visibility: 'PUBLIC',
          moderationStatus: 'APPROVED',
          updatedAt: 2,
        }
      ),
      false
    );
  });

  it('detecta mudança autoritativa que retira eligibility da foto', () => {
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

});
