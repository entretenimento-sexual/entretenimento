import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluatePublicMediaOwnerExposure,
  evaluatePublicMediaSignedOwnerExposure,
  isCurrentPublicMediaAssetExposure,
  isCurrentPublicMediaBoostExposure,
  isCurrentPublicMediaProjectionExposure,
  isCurrentPublicPhotoAssetExposure,
} from './public-media-exposure.policy';

const NOW = 1_800_000_000_000;

function publicProjection(overrides: Record<string, unknown> = {}) {
  return {
    ownerUid: 'owner-1',
    ageEligibilityVerifiedAdult: true,
    ageEligibilityValidUntil: {
      toMillis: () => NOW + 60_000,
    },
    visibility: 'PUBLIC',
    moderationStatus: 'APPROVED',
    ...overrides,
  };
}

function publication(overrides: Record<string, unknown> = {}) {
  return {
    isPublished: true,
    visibility: 'PUBLIC',
    moderationStatus: 'APPROVED',
    ...overrides,
  };
}

describe('public media exposure policy', () => {
  it('bloqueia lifecycle sem projeção pública e bloqueio bilateral', () => {
    assert.equal(
      evaluatePublicMediaOwnerExposure({
        publicProfile: null,
        viewerBlocked: false,
        nowMs: NOW,
      }).allowed,
      false
    );

    assert.equal(
      evaluatePublicMediaOwnerExposure({
        publicProfile: publicProjection(),
        viewerBlocked: true,
        nowMs: NOW,
      }).denialReason,
      'BILATERAL_BLOCK'
    );
  });

  it('expira owner pela projeção e pela autoridade etária canônica', () => {
    assert.equal(
      evaluatePublicMediaOwnerExposure({
        publicProfile: publicProjection({
          ageEligibilityValidUntil: { toMillis: () => NOW },
        }),
        viewerBlocked: false,
        nowMs: NOW,
      }).allowed,
      false
    );

    assert.equal(
      evaluatePublicMediaSignedOwnerExposure({
        publicProfile: publicProjection(),
        viewerBlocked: false,
        canonicalAgeAllowed: false,
        canonicalAgeExpiresAtMs: null,
        nowMs: NOW,
      }).denialReason,
      'OWNER_AGE_NOT_CANONICAL'
    );

    const allowed = evaluatePublicMediaSignedOwnerExposure({
      publicProfile: publicProjection({
        ageEligibilityValidUntil: { toMillis: () => NOW + 60_000 },
      }),
      viewerBlocked: false,
      canonicalAgeAllowed: true,
      canonicalAgeExpiresAtMs: NOW + 30_000,
      nowMs: NOW,
    });

    assert.equal(allowed.allowed, true);
    assert.equal(allowed.validUntilMs, NOW + 30_000);
  });

  it('usa a mesma base APPROVED + maioridade vigente em discovery e ranking', () => {
    assert.equal(
      isCurrentPublicMediaProjectionExposure(publicProjection(), NOW),
      true
    );
    assert.equal(
      isCurrentPublicMediaProjectionExposure(
        publicProjection({ moderationStatus: 'PENDING_REVIEW' }),
        NOW
      ),
      false
    );
    assert.equal(
      isCurrentPublicMediaProjectionExposure(
        publicProjection({ visibility: 'FRIENDS' }),
        NOW
      ),
      false
    );
  });

  it('boost exige a mesma exposição pública e campanha ativa', () => {
    assert.equal(
      isCurrentPublicMediaBoostExposure(
        publicProjection({
          boostActive: true,
          boostedUntil: NOW + 60_000,
        }),
        NOW
      ),
      true
    );
    assert.equal(
      isCurrentPublicMediaBoostExposure(
        publicProjection({
          boostActive: true,
          boostedUntil: NOW,
        }),
        NOW
      ),
      false
    );
    assert.equal(
      isCurrentPublicMediaBoostExposure(
        publicProjection({
          moderationStatus: 'FLAGGED',
          boostActive: true,
          boostedUntil: NOW + 60_000,
        }),
        NOW
      ),
      false
    );
  });

  it('signed URL revalida publicação autoritativa e moderação', () => {
    assert.equal(
      isCurrentPublicMediaAssetExposure({
        publicMedia: publicProjection(),
        publication: publication(),
        ownerExposureAllowed: true,
        nowMs: NOW,
        allowedVisibilities: ['PUBLIC'],
      }),
      true
    );

    assert.equal(
      isCurrentPublicMediaAssetExposure({
        publicMedia: publicProjection(),
        publication: publication({ moderationStatus: 'PENDING_REVIEW' }),
        ownerExposureAllowed: true,
        nowMs: NOW,
        allowedVisibilities: ['PUBLIC'],
      }),
      false
    );

    assert.equal(
      isCurrentPublicMediaAssetExposure({
        publicMedia: publicProjection(),
        publication: publication({ visibility: 'FRIENDS' }),
        ownerExposureAllowed: true,
        nowMs: NOW,
        allowedVisibilities: ['PUBLIC'],
      }),
      false
    );
  });

  it('foto FRIENDS depende da audiência depois da mesma base de exposure', () => {
    const friendsProjection = publicProjection({ visibility: 'FRIENDS' });
    const friendsPublication = publication({ visibility: 'FRIENDS' });

    assert.equal(
      isCurrentPublicPhotoAssetExposure({
        publicMedia: friendsProjection,
        publication: friendsPublication,
        ownerExposureAllowed: true,
        viewerIsOwner: false,
        viewerIsFriend: true,
        nowMs: NOW,
      }),
      true
    );
    assert.equal(
      isCurrentPublicPhotoAssetExposure({
        publicMedia: friendsProjection,
        publication: friendsPublication,
        ownerExposureAllowed: true,
        viewerIsOwner: false,
        viewerIsFriend: false,
        nowMs: NOW,
      }),
      false
    );
  });
});
