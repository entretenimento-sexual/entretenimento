import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateCanonicalVideoAudienceContext,
  type CanonicalVideoAudienceContextInput,
} from './video-audience-context.policy';

const VIEWER_UID = 'viewer_1';
const OWNER_UID = 'owner_1';
const VIDEO_ID = 'video_1';

function eligibleUser(uid: string): Readonly<Record<string, unknown>> {
  return {
    uid,
    accountStatus: 'active',
    suspended: false,
    interactionBlocked: false,
    accountLocked: false,
    loginAllowed: true,
    emailVerified: true,
    profileCompleted: true,
    initialAdultConsentRequired: false,
  };
}

function input(
  overrides: Partial<CanonicalVideoAudienceContextInput> = {}
): CanonicalVideoAudienceContextInput {
  return {
    viewerUid: VIEWER_UID,
    ownerUid: OWNER_UID,
    videoId: VIDEO_ID,
    action: 'PLAY',
    viewerUser: eligibleUser(VIEWER_UID),
    ownerUser: eligibleUser(OWNER_UID),
    viewerAuth: { disabled: false, emailVerified: true },
    ownerAuth: { disabled: false, emailVerified: true },
    publicVideo: {
      id: VIDEO_ID,
      ownerUid: OWNER_UID,
      mediaType: 'VIDEO',
      assetAccess: 'SIGNED_URL',
      visibility: 'PUBLIC',
      moderationStatus: 'APPROVED',
    },
    publication: {
      ownerUid: OWNER_UID,
      videoId: VIDEO_ID,
      isPublished: true,
      visibility: 'PUBLIC',
      moderationStatus: 'APPROVED',
    },
    viewerBlockedOwner: false,
    ownerBlockedViewer: false,
    bilateralFriendship: false,
    ...overrides,
  };
}

test('autoriza contexto público canônico com contas operacionais', () => {
  const result = evaluateCanonicalVideoAudienceContext(input());

  assert.equal(result.decision.allowed, true);
  assert.equal(result.decision.reason, null);
  assert.equal(result.target?.action, 'PLAY');
});

test('bloqueia quando o visitante está restrito', () => {
  const result = evaluateCanonicalVideoAudienceContext(input({
    viewerUser: {
      ...eligibleUser(VIEWER_UID),
      accountStatus: 'suspended',
    },
  }));

  assert.equal(result.decision.allowed, false);
  assert.equal(result.decision.reason, 'viewer_restricted');
});

test('bloqueia quando existe bloqueio em qualquer sentido', () => {
  const viewerBlocked = evaluateCanonicalVideoAudienceContext(input({
    viewerBlockedOwner: true,
  }));
  const ownerBlocked = evaluateCanonicalVideoAudienceContext(input({
    ownerBlockedViewer: true,
  }));

  assert.equal(viewerBlocked.decision.reason, 'blocked');
  assert.equal(ownerBlocked.decision.reason, 'blocked');
});

test('exige amizade bilateral para audiência FRIENDS', () => {
  const publicVideo = {
    ...(input().publicVideo as Readonly<Record<string, unknown>>),
    visibility: 'FRIENDS',
  };
  const publication = {
    ...(input().publication as Readonly<Record<string, unknown>>),
    visibility: 'FRIENDS',
  };
  const denied = evaluateCanonicalVideoAudienceContext(input({
    publicVideo,
    publication,
    bilateralFriendship: false,
  }));
  const allowed = evaluateCanonicalVideoAudienceContext(input({
    publicVideo,
    publication,
    bilateralFriendship: true,
  }));

  assert.equal(denied.decision.reason, 'friendship_required');
  assert.equal(allowed.decision.allowed, true);
});

test('rejeita divergência entre projeção e publicação', () => {
  const result = evaluateCanonicalVideoAudienceContext(input({
    publication: {
      ...(input().publication as Readonly<Record<string, unknown>>),
      moderationStatus: 'PENDING',
    },
  }));

  assert.equal(result.target, null);
  assert.equal(result.decision.reason, 'invalid_target');
});
