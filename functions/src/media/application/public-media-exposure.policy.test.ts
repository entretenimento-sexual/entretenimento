import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluatePublicMediaOwnerExposure,
  evaluatePublicMediaSignedOwnerExposure,
  isCurrentPublicMediaAssetExposure,
  isCurrentPublicMediaProjectionExposure,
  isCurrentPublicPhotoAssetExposure,
} from './public-media-exposure.policy';

const NOW = 1_800_000_000_000;

function publicProjection(overrides: Record<string, unknown> = {}) {
  return {
    ownerUid: 'owner-1',
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
  it('bloqueia lifecycle canônico, ausência de perfil público e bloqueio bilateral', () => {
    assert.equal(
      evaluatePublicMediaOwnerExposure({
        canonicalOwnerLifecycleAllowed: false,
        publicProfile: { uid: 'owner-1' },
        viewerBlocked: false,
        nowMs: NOW,
      }).denialReason,
      'OWNER_LIFECYCLE_NOT_CANONICAL'
    );

    assert.equal(
      evaluatePublicMediaOwnerExposure({
        canonicalOwnerLifecycleAllowed: true,
        publicProfile: null,
        viewerBlocked: false,
        nowMs: NOW,
      }).allowed,
      false
    );

    assert.equal(
      evaluatePublicMediaOwnerExposure({
        canonicalOwnerLifecycleAllowed: true,
        publicProfile: { uid: 'owner-1' },
        viewerBlocked: true,
        nowMs: NOW,
      }).denialReason,
      'BILATERAL_BLOCK'
    );
  });

  it('usa a mesma autoridade de lifecycle para URL assinada', () => {
    const input = {
      canonicalOwnerLifecycleAllowed: true,
      publicProfile: { uid: 'owner-1' },
      viewerBlocked: false,
      nowMs: NOW,
    };

    assert.deepEqual(
      evaluatePublicMediaSignedOwnerExposure(input),
      evaluatePublicMediaOwnerExposure(input)
    );
  });

  it('ignora campos etários legados da mídia e decide por moderação e audiência', () => {
    assert.equal(
      isCurrentPublicMediaProjectionExposure(
        publicProjection({
          ageEligibilityVerifiedAdult: false,
          ageEligibilityValidUntil: null,
        }),
        NOW
      ),
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

  it('URL assinada revalida publicação autoritativa e moderação', () => {
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
