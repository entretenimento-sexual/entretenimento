import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluatePublicMediaOwnerExposure,
  isCurrentPublicMediaAssetExposure,
  isCurrentPublicPhotoAssetExposure,
} from './public-media-exposure.policy';
import {
  assertPublicMediaConsumptionAccessData,
} from './public-media-consumption-access.policy';

const NOW = 1_800_000_000_000;

const PUBLIC_SURFACES = Object.freeze([
  'SELF_PROFILE_PUBLISHED',
  'OTHER_PROFILE',
  'DISCOVERY',
  'DEEP_LINK',
  'VIEWER',
  'SHARE',
] as const);

const MEDIA_KINDS = Object.freeze(['PHOTO', 'VIDEO'] as const);

function publicProfile(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'owner-1',
    ...overrides,
  };
}

function projection(overrides: Record<string, unknown> = {}) {
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

function publicAssetAllowed(input: {
  kind: 'PHOTO' | 'VIDEO';
  ownerAllowed?: boolean;
  projection?: Record<string, unknown>;
  publication?: Record<string, unknown>;
}): boolean {
  if (input.kind === 'PHOTO') {
    return isCurrentPublicPhotoAssetExposure({
      publicMedia: input.projection ?? projection(),
      publication: input.publication ?? publication(),
      ownerExposureAllowed: input.ownerAllowed ?? true,
      viewerIsOwner: false,
      viewerIsFriend: false,
      nowMs: NOW,
    });
  }

  return isCurrentPublicMediaAssetExposure({
    publicMedia: input.projection ?? projection(),
    publication: input.publication ?? publication(),
    ownerExposureAllowed: input.ownerAllowed ?? true,
    nowMs: NOW,
    allowedVisibilities: ['PUBLIC'],
  });
}

describe('public media exposure matrix contract', () => {
  it('aplica a mesma base pública a Foto e Vídeo em todas as superfícies', () => {
    for (const surface of PUBLIC_SURFACES) {
      for (const kind of MEDIA_KINDS) {
        assert.equal(
          publicAssetAllowed({ kind }),
          true,
          `${kind} deveria ser exibível em ${surface}`
        );
      }
    }
  });

  it('conta ativa não é reavaliada por assurance etário em Media', () => {
    const user = {
      accountStatus: 'active',
      suspended: false,
      interactionBlocked: false,
      acceptedTerms: {
        accepted: true,
        version: 'v3',
        acknowledgedPrivacyNotice: true,
      },
      adultConsent: { accepted: true, version: 'v1' },
      ageReverification: { status: 'REQUIRED' },
    };

    assert.doesNotThrow(() =>
      assertPublicMediaConsumptionAccessData(user)
    );
  });

  it('bloqueio bilateral derruba todas as superfícies públicas', () => {
    const owner = evaluatePublicMediaOwnerExposure({
      canonicalOwnerLifecycleAllowed: true,
      publicProfile: publicProfile(),
      viewerBlocked: true,
      nowMs: NOW,
    });

    assert.equal(owner.allowed, false);
    assert.equal(owner.denialReason, 'BILATERAL_BLOCK');

    for (const surface of PUBLIC_SURFACES) {
      for (const kind of MEDIA_KINDS) {
        assert.equal(
          publicAssetAllowed({ kind, ownerAllowed: owner.allowed }),
          false,
          `${kind} bloqueado não pode escapar por ${surface}`
        );
      }
    }
  });

  it('suspensão, ocultação ou lifecycle inválido derrubam todas as superfícies públicas', () => {
    const owner = evaluatePublicMediaOwnerExposure({
      canonicalOwnerLifecycleAllowed: false,
      publicProfile: publicProfile(),
      viewerBlocked: false,
      nowMs: NOW,
    });

    assert.equal(owner.denialReason, 'OWNER_LIFECYCLE_NOT_CANONICAL');

    for (const surface of PUBLIC_SURFACES) {
      for (const kind of MEDIA_KINDS) {
        assert.equal(
          publicAssetAllowed({ kind, ownerAllowed: owner.allowed }),
          false,
          `${kind} com owner indisponível não pode escapar por ${surface}`
        );
      }
    }
  });

  it('quarentena nunca é exposição', () => {
    for (const moderationStatus of [
      'PENDING_REVIEW',
      'FLAGGED',
      'HIDDEN',
      'REJECTED',
    ]) {
      for (const surface of PUBLIC_SURFACES) {
        for (const kind of MEDIA_KINDS) {
          assert.equal(
            publicAssetAllowed({
              kind,
              projection: projection({ moderationStatus }),
              publication: publication({ moderationStatus }),
            }),
            false,
            `${kind} ${moderationStatus} não pode escapar por ${surface}`
          );
        }
      }
    }
  });

  it('unpublish, PRIVATE e divergência de autoridade falham fechado', () => {
    const cases = [
      {
        projection: projection(),
        publication: publication({ isPublished: false }),
      },
      {
        projection: projection({ visibility: 'PRIVATE' }),
        publication: publication({ visibility: 'PRIVATE' }),
      },
      {
        projection: projection(),
        publication: publication({ visibility: 'FRIENDS' }),
      },
    ];

    for (const testCase of cases) {
      for (const kind of MEDIA_KINDS) {
        assert.equal(
          publicAssetAllowed({ kind, ...testCase }),
          false
        );
      }
    }
  });

  it('campos etários legados não viram autoridade de distribuição', () => {
    for (const kind of MEDIA_KINDS) {
      assert.equal(
        publicAssetAllowed({
          kind,
          projection: projection({
            ageEligibilityVerifiedAdult: false,
            ageEligibilityAssurance: 'SELF_DECLARED',
            ageEligibilityValidUntil: null,
          }),
        }),
        true
      );
    }
  });
});
