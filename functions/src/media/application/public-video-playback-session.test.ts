import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PUBLIC_VIDEO_PLAYBACK_SESSION_SCHEMA_VERSION,
  PUBLIC_VIDEO_PLAYBACK_SESSION_TTL_MS,
  createPublicVideoPlaybackToken,
  hashPublicVideoPlaybackToken,
  validatePublicVideoPlaybackSession,
} from './public-video-playback-session';

const NOW = 1_800_000_000_000;
const REQUIRED_PLAYBACK_MS = 7_500;
const VIDEO_VERSION = NOW - 60_000;
const VIEWER_UID = 'viewer-1';
const OWNER_UID = 'owner-1';
const VIDEO_ID = 'video-1';

function createFixture() {
  const playbackToken = createPublicVideoPlaybackToken();
  const issuedAt = NOW - REQUIRED_PLAYBACK_MS;

  return {
    playbackToken,
    data: {
      schemaVersion: PUBLIC_VIDEO_PLAYBACK_SESSION_SCHEMA_VERSION,
      viewerUid: VIEWER_UID,
      ownerUid: OWNER_UID,
      videoId: VIDEO_ID,
      tokenHash: hashPublicVideoPlaybackToken(playbackToken),
      issuedAt,
      earliestQualifiedAt: issuedAt + REQUIRED_PLAYBACK_MS,
      expiresAt: issuedAt + PUBLIC_VIDEO_PLAYBACK_SESSION_TTL_MS,
      requiredPlaybackMs: REQUIRED_PLAYBACK_MS,
      videoVersion: VIDEO_VERSION,
      consumedAt: null,
    },
  };
}

describe('public-video-playback-session', () => {
  it('aceita token íntegro somente após o limiar emitido pelo servidor', () => {
    const fixture = createFixture();

    assert.deepEqual(
      validatePublicVideoPlaybackSession({
        data: fixture.data,
        playbackToken: fixture.playbackToken,
        viewerUid: VIEWER_UID,
        ownerUid: OWNER_UID,
        videoId: VIDEO_ID,
        videoVersion: VIDEO_VERSION,
        now: NOW,
      }),
      {
        valid: true,
        tokenHash: hashPublicVideoPlaybackToken(fixture.playbackToken),
        requiredPlaybackMs: REQUIRED_PLAYBACK_MS,
        issuedAt: NOW - REQUIRED_PLAYBACK_MS,
        expiresAt:
          NOW - REQUIRED_PLAYBACK_MS + PUBLIC_VIDEO_PLAYBACK_SESSION_TTL_MS,
      }
    );
  });

  it('rejeita tentativa anterior ao tempo mínimo do servidor', () => {
    const fixture = createFixture();

    assert.deepEqual(
      validatePublicVideoPlaybackSession({
        data: fixture.data,
        playbackToken: fixture.playbackToken,
        viewerUid: VIEWER_UID,
        ownerUid: OWNER_UID,
        videoId: VIDEO_ID,
        videoVersion: VIDEO_VERSION,
        now: NOW - 1,
      }),
      { valid: false, reason: 'too-early' }
    );
  });

  it('rejeita token adulterado e identidade diferente', () => {
    const fixture = createFixture();

    assert.deepEqual(
      validatePublicVideoPlaybackSession({
        data: fixture.data,
        playbackToken: `${fixture.playbackToken}x`,
        viewerUid: VIEWER_UID,
        ownerUid: OWNER_UID,
        videoId: VIDEO_ID,
        videoVersion: VIDEO_VERSION,
        now: NOW,
      }),
      { valid: false, reason: 'invalid-token' }
    );

    assert.deepEqual(
      validatePublicVideoPlaybackSession({
        data: fixture.data,
        playbackToken: fixture.playbackToken,
        viewerUid: 'viewer-2',
        ownerUid: OWNER_UID,
        videoId: VIDEO_ID,
        videoVersion: VIDEO_VERSION,
        now: NOW,
      }),
      { valid: false, reason: 'identity-mismatch' }
    );
  });

  it('rejeita sessão consumida, expirada ou emitida para outra versão', () => {
    const fixture = createFixture();

    assert.deepEqual(
      validatePublicVideoPlaybackSession({
        data: { ...fixture.data, consumedAt: NOW - 100 },
        playbackToken: fixture.playbackToken,
        viewerUid: VIEWER_UID,
        ownerUid: OWNER_UID,
        videoId: VIDEO_ID,
        videoVersion: VIDEO_VERSION,
        now: NOW,
      }),
      { valid: false, reason: 'consumed' }
    );

    assert.deepEqual(
      validatePublicVideoPlaybackSession({
        data: {
          ...fixture.data,
          issuedAt: NOW - PUBLIC_VIDEO_PLAYBACK_SESSION_TTL_MS,
          earliestQualifiedAt:
            NOW - PUBLIC_VIDEO_PLAYBACK_SESSION_TTL_MS +
            REQUIRED_PLAYBACK_MS,
          expiresAt: NOW,
        },
        playbackToken: fixture.playbackToken,
        viewerUid: VIEWER_UID,
        ownerUid: OWNER_UID,
        videoId: VIDEO_ID,
        videoVersion: VIDEO_VERSION,
        now: NOW,
      }),
      { valid: false, reason: 'expired' }
    );

    assert.deepEqual(
      validatePublicVideoPlaybackSession({
        data: fixture.data,
        playbackToken: fixture.playbackToken,
        viewerUid: VIEWER_UID,
        ownerUid: OWNER_UID,
        videoId: VIDEO_ID,
        videoVersion: VIDEO_VERSION + 1,
        now: NOW,
      }),
      { valid: false, reason: 'stale-video' }
    );
  });
});
