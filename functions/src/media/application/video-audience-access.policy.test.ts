import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateVideoAccountAccess,
  evaluateVideoAudienceAccess,
  resolveCanonicalVideoAudienceTarget,
  type VideoAudienceAccessInput,
} from './video-audience-access.policy';

function account(overrides: Record<string, unknown> = {}) {
  return {
    uid: 'viewer-uid',
    accountStatus: 'active',
    suspended: false,
    interactionBlocked: false,
    accountLocked: false,
    loginAllowed: true,
    emailVerified: true,
    profileCompleted: true,
    initialAdultConsentRequired: true,
    adultConsent: { accepted: true },
    acceptedTerms: { accepted: true },
    ageReverification: { status: 'VERIFIED', result: 'ADULT' },
    ...overrides,
  };
}

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
    ownerLifecycleAllowed: true,
    viewerBlockedOwner: false,
    ownerBlockedViewer: false,
    bilateralFriendship: false,
    mutuallyCompatible: false,
    hasCreatorSubscriberEntitlement: false,
    hasCreatorPremiumEntitlement: false,
    ...overrides,
  };
}

describe('video-audience-access.policy / conta', () => {
  it('aceita conta operacional, adulta e com termos vigentes', () => {
    assert.deepEqual(
      evaluateVideoAccountAccess(account(), 'viewer-uid'),
      { allowed: true, reason: null }
    );
  });

  it('nega UID divergente, conta restrita e e-mail não confirmado', () => {
    assert.deepEqual(
      evaluateVideoAccountAccess(account(), 'other-uid'),
      { allowed: false, reason: 'profile_missing' }
    );
    assert.deepEqual(
      evaluateVideoAccountAccess(
        account({ accountLocked: true }),
        'viewer-uid'
      ),
      { allowed: false, reason: 'account_restricted' }
    );
    assert.deepEqual(
      evaluateVideoAccountAccess(
        account({ emailVerified: false }),
        'viewer-uid'
      ),
      { allowed: false, reason: 'email_unverified' }
    );
  });

  it('nega menoridade e qualquer estado pendente de revalidação', () => {
    assert.deepEqual(
      evaluateVideoAccountAccess(account({ idade: 17 }), 'viewer-uid'),
      { allowed: false, reason: 'adult_access_required' }
    );
    assert.deepEqual(
      evaluateVideoAccountAccess(
        account({ ageReverification: { status: 'UNDER_REVIEW' } }),
        'viewer-uid'
      ),
      { allowed: false, reason: 'adult_access_required' }
    );
    assert.deepEqual(
      evaluateVideoAccountAccess(
        account({ ageReverification: { result: 'UNDERAGE' } }),
        'viewer-uid'
      ),
      { allowed: false, reason: 'adult_access_required' }
    );
  });

  it('nega consentimento, termos e perfil incompleto', () => {
    assert.deepEqual(
      evaluateVideoAccountAccess(
        account({ adultConsent: { accepted: false } }),
        'viewer-uid'
      ),
      { allowed: false, reason: 'adult_access_required' }
    );
    assert.deepEqual(
      evaluateVideoAccountAccess(
        account({ acceptedTerms: { accepted: false } }),
        'viewer-uid'
      ),
      { allowed: false, reason: 'terms_required' }
    );
    assert.deepEqual(
      evaluateVideoAccountAccess(
        account({ profileCompleted: false }),
        'viewer-uid'
      ),
      { allowed: false, reason: 'profile_incomplete' }
    );
  });

  it('permite ignorar e-mail do autor sem ignorar lifecycle adulto', () => {
    assert.deepEqual(
      evaluateVideoAccountAccess(
        account({ emailVerified: false }),
        'viewer-uid',
        { requireVerifiedEmail: false }
      ),
      { allowed: true, reason: null }
    );
    assert.deepEqual(
      evaluateVideoAccountAccess(
        account({
          emailVerified: false,
          ageReverification: { status: 'EXPIRED' },
        }),
        'viewer-uid',
        { requireVerifiedEmail: false }
      ),
      { allowed: false, reason: 'adult_access_required' }
    );
  });
});

describe('video-audience-access.policy / audiência', () => {
  it('permite PUBLIC somente quando visitante e autor estão operacionais', () => {
    assert.deepEqual(
      evaluateVideoAudienceAccess(accessInput()),
      { allowed: true, reason: null }
    );
    assert.deepEqual(
      evaluateVideoAudienceAccess(accessInput({
        viewerLifecycleAllowed: false,
      })),
      { allowed: false, reason: 'viewer_restricted' }
    );
    assert.deepEqual(
      evaluateVideoAudienceAccess(accessInput({
        ownerLifecycleAllowed: false,
      })),
      { allowed: false, reason: 'owner_restricted' }
    );
  });

  it('nega publicação ausente ou moderação diferente de APPROVED', () => {
    assert.deepEqual(
      evaluateVideoAudienceAccess(accessInput({ isPublished: false })),
      { allowed: false, reason: 'not_published' }
    );
    assert.deepEqual(
      evaluateVideoAudienceAccess(accessInput({
        moderationStatus: 'PENDING_REVIEW',
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

  it('exige as duas arestas de amizade para FRIENDS', () => {
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

  it('mantém compatibilidade e entitlements do criador fechados por padrão', () => {
    assert.deepEqual(
      evaluateVideoAudienceAccess(accessInput({ visibility: 'COMPATIBLE' })),
      { allowed: false, reason: 'compatibility_required' }
    );
    assert.deepEqual(
      evaluateVideoAudienceAccess(accessInput({ visibility: 'SUBSCRIBERS' })),
      { allowed: false, reason: 'subscriber_entitlement_required' }
    );
    assert.deepEqual(
      evaluateVideoAudienceAccess(accessInput({ visibility: 'PREMIUM' })),
      { allowed: false, reason: 'premium_entitlement_required' }
    );
  });

  it('não deixa o autor ignorar publicação, moderação ou lifecycle', () => {
    assert.deepEqual(
      evaluateVideoAudienceAccess(accessInput({
        viewerUid: 'owner-uid',
        visibility: 'PREMIUM',
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
    assert.deepEqual(
      evaluateVideoAudienceAccess(accessInput({
        viewerUid: 'owner-uid',
        ownerLifecycleAllowed: false,
      })),
      { allowed: false, reason: 'owner_restricted' }
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
});

describe('video-audience-access.policy / fonte canônica', () => {
  const publicVideo = {
    id: 'video-uid',
    ownerUid: 'owner-uid',
    mediaType: 'VIDEO',
    assetAccess: 'SIGNED_URL',
    visibility: 'PUBLIC',
    moderationStatus: 'APPROVED',
  };
  const publication = {
    ownerUid: 'owner-uid',
    videoId: 'video-uid',
    isPublished: true,
    visibility: 'PUBLIC',
    moderationStatus: 'APPROVED',
  };

  it('resolve projeção e publicação equivalentes', () => {
    assert.deepEqual(
      resolveCanonicalVideoAudienceTarget({
        ownerUid: 'owner-uid',
        videoId: 'video-uid',
        action: 'PLAY',
        publicVideo,
        publication,
      }),
      {
        ownerUid: 'owner-uid',
        action: 'PLAY',
        visibility: 'PUBLIC',
        isPublished: true,
        moderationStatus: 'APPROVED',
      }
    );
  });

  it('falha fechada quando identidade ou visibilidade divergem', () => {
    assert.equal(
      resolveCanonicalVideoAudienceTarget({
        ownerUid: 'owner-uid',
        videoId: 'video-uid',
        action: 'PLAY',
        publicVideo: { ...publicVideo, ownerUid: 'other-owner' },
        publication,
      }),
      null
    );
    assert.equal(
      resolveCanonicalVideoAudienceTarget({
        ownerUid: 'owner-uid',
        videoId: 'video-uid',
        action: 'PLAY',
        publicVideo,
        publication: { ...publication, visibility: 'FRIENDS' },
      }),
      null
    );
  });
});
