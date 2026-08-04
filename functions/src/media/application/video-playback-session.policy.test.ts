import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createVideoPlaybackSessionToken,
  evaluateVideoPlaybackSession,
  hashVideoPlaybackSessionToken,
  normalizeVideoPlaybackSessionToken,
} from './video-playback-session.policy';

const NOW = 1_800_000_000_000;
const SESSION = Object.freeze({
  viewerUid: 'viewer_1',
  ownerUid: 'owner_1',
  videoId: 'video_1',
  appId: 'app_1',
  issuedAt: NOW - 1_000,
  expiresAt: NOW + 60_000,
  consumedAt: null,
});

test('gera token opaco seguro e hash determinístico', () => {
  const token = createVideoPlaybackSessionToken();

  assert.equal(normalizeVideoPlaybackSessionToken(token), token);
  assert.equal(hashVideoPlaybackSessionToken(token).length, 64);
  assert.equal(
    hashVideoPlaybackSessionToken(token),
    hashVideoPlaybackSessionToken(token)
  );
  assert.notEqual(createVideoPlaybackSessionToken(), token);
});

test('autoriza somente identidade, app e prazo correspondentes', () => {
  assert.deepEqual(
    evaluateVideoPlaybackSession({
      session: SESSION,
      viewerUid: 'viewer_1',
      ownerUid: 'owner_1',
      videoId: 'video_1',
      appId: 'app_1',
      now: NOW,
    }),
    { allowed: true, reason: null }
  );

  assert.equal(
    evaluateVideoPlaybackSession({
      session: SESSION,
      viewerUid: 'other',
      ownerUid: 'owner_1',
      videoId: 'video_1',
      appId: 'app_1',
      now: NOW,
    }).reason,
    'identity_mismatch'
  );

  assert.equal(
    evaluateVideoPlaybackSession({
      session: SESSION,
      viewerUid: 'viewer_1',
      ownerUid: 'owner_1',
      videoId: 'video_1',
      appId: 'other_app',
      now: NOW,
    }).reason,
    'app_mismatch'
  );
});

test('rejeita sessão ausente, expirada ou consumida', () => {
  assert.equal(
    evaluateVideoPlaybackSession({
      session: null,
      viewerUid: 'viewer_1',
      ownerUid: 'owner_1',
      videoId: 'video_1',
      appId: 'app_1',
      now: NOW,
    }).reason,
    'missing'
  );

  assert.equal(
    evaluateVideoPlaybackSession({
      session: { ...SESSION, expiresAt: NOW },
      viewerUid: 'viewer_1',
      ownerUid: 'owner_1',
      videoId: 'video_1',
      appId: 'app_1',
      now: NOW,
    }).reason,
    'expired'
  );

  assert.equal(
    evaluateVideoPlaybackSession({
      session: { ...SESSION, consumedAt: NOW - 10 },
      viewerUid: 'viewer_1',
      ownerUid: 'owner_1',
      videoId: 'video_1',
      appId: 'app_1',
      now: NOW,
    }).reason,
    'already_consumed'
  );
});
