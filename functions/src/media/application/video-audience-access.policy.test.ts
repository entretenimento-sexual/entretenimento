import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertVideoAudienceAccessDecision,
  evaluateVideoAudienceAccess,
  resolveCanonicalVideoAudienceTarget,
  type VideoAudienceAccessInput,
} from './video-audience-access.policy';

function accessInput(
  overrides: Partial<VideoAudienceAccessInput> = {}
): VideoAudienceAccessInput {
  return {
    viewerUid: 'viewer-uid',
    ownerUid: 'owner-uid',
    action: 'PLAY',
    visibility: 'PUBLIC',
    isPublished: true,
    moderationStatus: 'APPROVED',
    viewerLifecycleAllowed: true,
    viewerBlockedOwner: false,
    ownerBlockedViewer: false,
    bilateralFriendship: false,
    mutuallyCompatible: false,
    hasCreatorSubscriberEntitlement: false,
    hasCreatorPremiumEntitlement: false,
    ...overrides,
  };
}

describe('video-audience-access.policy', () => {
  it('permite vídeo público aprovado para conta elegível', () => {
    assert.deepEqual(
      evaluateVideoAudienceAccess(accessInput()),
      { allowed: true, reason: null }
    );
  });

  it('nega conta restrita antes de avaliar a audiência', () => {
    assert.deepEqual(
      evaluateVideoAudienceAccess(accessInput({
        viewerLifecycleAllowed: false,
      })),
      { allowed: false, reason: 'viewer_restricted' }
    );
  });

  it('nega conteúdo não publicado ou sem aprovação', () => {
    assert.deepEqual(
      evaluateVideoAudienceAccess(accessInput({ isPublished: false })),
      { allowed: false, reason: 'not_published' }
    );
    assert.deepEqual(
      evaluateVideoAudienceAccess(accessInput({
        moderationStatus: 'PENDING',
      })),
      { allowed: false, reason: 'moderation_required' }
    );
  });

  it('nega bloqueio em qualquer direção', () => {
    assert.deepEqual(
      evaluateVideoAudienceAccess(accessInput({
        viewerBlockedOwner: true,
      })),
      { allowed: false, reason: 'blocked' }
    );
    assert.deepEqual(
      evaluateVideoAudienceAccess(accessInput({
        ownerBlockedViewer: true,
      })),
      { allowed: false, reason: 'blocked' }
    );
  });

  it('exige amizade bilateral para FRIENDS', () => {
    assert.deepEqual(
      evaluateVideoAudienceAccess(accessInput({ visibility: 'FRIENDS' })),
      { allowed: false, reason: 'friendship_required' }
    );
    assert.deepEqual(
      evaluateVideoAudienceAccess(accessInput({
        visibility: 'FRIENDS',
        bilateralFriendship: true,
      })),
      { allowed: true, reason: null }
    );
  });

  it('exige compatibilidade canônica para COMPATIBLE', () => {
    assert.deepEqual(
      evaluateVideoAudienceAccess(accessInput({ visibility: 'COMPATIBLE' })),
      { allowed: false, reason: 'compatibility_required' }
    );
    assert.deepEqual(
      evaluateVideoAudienceAccess(accessInput({
        visibility: 'COMPATIBLE',
        mutuallyCompatible: true,
      })),
      { allowed: true, reason: null }
    );
  });

  it('não confunde assinatura da plataforma com entitlement do criador', () => {
    assert.deepEqual(
      evaluateVideoAudienceAccess(accessInput({ visibility: 'SUBSCRIBERS' })),
      { allowed: false, reason: 'subscriber_entitlement_required' }
    );
    assert.deepEqual(
      evaluateVideoAudienceAccess(accessInput({
        visibility: 'SUBSCRIBERS',
        hasCreatorSubscriberEntitlement: true,
      })),
      { allowed: true, reason: null }
    );
    assert.deepEqual(
      evaluateVideoAudienceAccess(accessInput({ visibility: 'PREMIUM' })),
      { allowed: false, reason: 'premium_entitlement_required' }
    );
  });

  it('permite ao autor ignorar relações, mas não publicação e moderação', () => {
    assert.deepEqual(
      evaluateVideoAudienceAccess(accessInput({
        viewerUid: 'owner-uid',
        visibility: 'PREMIUM',
        ownerBlockedViewer: true,
      })),
      { allowed: true, reason: null }
    );
    assert.deepEqual(
      evaluateVideoAudienceAccess(accessInput({
        viewerUid: 'owner-uid',
        isPublished: false,
      })),
      { allowed: false, reason: 'not_published' }
    );
  });

  it('nega PRIVATE e visibilidade desconhecida', () => {
    assert.deepEqual(
      evaluateVideoAudienceAccess(accessInput({ visibility: 'PRIVATE' })),
      { allowed: false, reason: 'private_content' }
    );
    assert.deepEqual(
      evaluateVideoAudienceAccess(accessInput({ visibility: 'CUSTOM' })),
      { allowed: false, reason: 'unsupported_visibility' }
    );
  });

  it('resolve somente projeção e publicação canônicas', () => {
    const target = resolveCanonicalVideoAudienceTarget({
      ownerUid: 'owner-uid',
      videoId: 'video-uid',
      action: 'INTERACT',
      publicVideo: {
        id: 'video-uid',
        ownerUid: 'owner-uid',
        mediaType: 'VIDEO',
        assetAccess: 'SIGNED_URL',
        visibility: 'PUBLIC',
        moderationStatus: 'APPROVED',
      },
      publication: {
        ownerUid: 'owner-uid',
        videoId: 'video-uid',
        isPublished: true,
        visibility: 'PUBLIC',
        moderationStatus: 'APPROVED',
      },
    });

    assert.deepEqual(target, {
      ownerUid: 'owner-uid',
      action: 'INTERACT',
      visibility: 'PUBLIC',
      isPublished: true,
      moderationStatus: 'APPROVED',
    });

    assert.equal(
      resolveCanonicalVideoAudienceTarget({
        ownerUid: 'owner-uid',
        videoId: 'video-uid',
        action: 'SHARE',
        publicVideo: {
          id: 'video-uid',
          ownerUid: 'owner-uid',
          mediaType: 'VIDEO',
          assetAccess: 'SIGNED_URL',
          visibility: 'PUBLIC',
          moderationStatus: 'APPROVED',
        },
        publication: {
          ownerUid: 'owner-uid',
          videoId: 'video-uid',
          isPublished: true,
          visibility: 'FRIENDS',
          moderationStatus: 'APPROVED',
        },
      }),
      null
    );
  });

  it('converte negação em erro callable sem expor direção do bloqueio', () => {
    assert.throws(
      () => assertVideoAudienceAccessDecision(
        { allowed: false, reason: 'blocked' },
        'SHARE'
      ),
      (error: unknown) => {
        const candidate = error as {
          code?: unknown;
          message?: unknown;
          details?: { reason?: unknown };
        };

        assert.equal(candidate.code, 'permission-denied');
        assert.match(String(candidate.message), /audiência válida/i);
        assert.equal(candidate.details?.reason, 'blocked');
        return true;
      }
    );
  });
});
