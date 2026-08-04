import assert from 'node:assert/strict';
import test from 'node:test';

import {
  VIDEO_VIEW_RATE_LIMIT_GLOBAL_MAX,
  VIDEO_VIEW_RATE_LIMIT_WINDOW_MS,
  evaluateFixedWindowRateLimit,
  evaluateVideoViewSession,
} from './video-view-session.policy';

test('reinicia janela expirada e incrementa de forma determinística', () => {
  const now = 1_000_000;
  const decision = evaluateFixedWindowRateLimit({
    state: {
      windowStartedAt: now - VIDEO_VIEW_RATE_LIMIT_WINDOW_MS,
      count: VIDEO_VIEW_RATE_LIMIT_GLOBAL_MAX,
    },
    now,
    windowMs: VIDEO_VIEW_RATE_LIMIT_WINDOW_MS,
    maxCount: VIDEO_VIEW_RATE_LIMIT_GLOBAL_MAX,
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.nextWindowStartedAt, now);
  assert.equal(decision.nextCount, 1);
});

test('bloqueia excesso e informa tempo restante', () => {
  const now = 1_000_000;
  const decision = evaluateFixedWindowRateLimit({
    state: { windowStartedAt: now - 1_000, count: 3 },
    now,
    windowMs: 10_000,
    maxCount: 3,
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.nextCount, 3);
  assert.equal(decision.retryAfterMs, 9_000);
});

test('aceita somente sessão emitida para usuário, vídeo e app corretos', () => {
  const base = {
    viewerUid: 'viewer_1',
    ownerUid: 'owner_1',
    videoId: 'video_1',
    status: 'ISSUED',
    appIdHash: 'app_hash',
    expiresAtMs: 20_000,
  };

  assert.deepEqual(
    evaluateVideoViewSession({
      session: base,
      viewerUid: 'viewer_1',
      ownerUid: 'owner_1',
      videoId: 'video_1',
      appIdHash: 'app_hash',
      now: 10_000,
    }),
    { allowed: true, reason: null }
  );

  assert.equal(
    evaluateVideoViewSession({
      session: { ...base, viewerUid: 'other' },
      viewerUid: 'viewer_1',
      ownerUid: 'owner_1',
      videoId: 'video_1',
      appIdHash: 'app_hash',
      now: 10_000,
    }).reason,
    'identity_mismatch'
  );

  assert.equal(
    evaluateVideoViewSession({
      session: { ...base, appIdHash: 'other_app' },
      viewerUid: 'viewer_1',
      ownerUid: 'owner_1',
      videoId: 'video_1',
      appIdHash: 'app_hash',
      now: 10_000,
    }).reason,
    'app_mismatch'
  );
});

test('rejeita sessão consumida ou expirada', () => {
  const session = {
    viewerUid: 'viewer_1',
    ownerUid: 'owner_1',
    videoId: 'video_1',
    status: 'CONSUMED',
    appIdHash: 'app_hash',
    expiresAtMs: 20_000,
  };

  assert.equal(
    evaluateVideoViewSession({
      session,
      viewerUid: 'viewer_1',
      ownerUid: 'owner_1',
      videoId: 'video_1',
      appIdHash: 'app_hash',
      now: 10_000,
    }).reason,
    'not_issued'
  );

  assert.equal(
    evaluateVideoViewSession({
      session: { ...session, status: 'ISSUED' },
      viewerUid: 'viewer_1',
      ownerUid: 'owner_1',
      videoId: 'video_1',
      appIdHash: 'app_hash',
      now: 20_000,
    }).reason,
    'expired'
  );
});
