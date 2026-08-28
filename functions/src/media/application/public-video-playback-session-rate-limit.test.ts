import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PUBLIC_VIDEO_PLAYBACK_BURST_MAX,
  PUBLIC_VIDEO_PLAYBACK_BURST_WINDOW_MS,
  PUBLIC_VIDEO_PLAYBACK_SUSTAINED_MAX,
  PUBLIC_VIDEO_PLAYBACK_SUSTAINED_WINDOW_MS,
  buildPublicVideoPlaybackRateLimitDecision,
} from './public-video-playback-session-rate-limit';

const NOW = 1_800_000_000_000;

describe('public-video-playback-session-rate-limit', () => {
  it('aceita a primeira sessão e inicializa as duas janelas', () => {
    const decision = buildPublicVideoPlaybackRateLimitDecision({
      now: NOW,
      state: null,
    });

    assert.deepEqual(decision, {
      allowed: true,
      retryAfterMs: 0,
      nextState: {
        burstWindowStartedAt: NOW,
        burstCount: 1,
        sustainedWindowStartedAt: NOW,
        sustainedCount: 1,
      },
    });
  });

  it('bloqueia quando o burst de um minuto atingiu o máximo', () => {
    const decision = buildPublicVideoPlaybackRateLimitDecision({
      now: NOW,
      state: {
        burstWindowStartedAt: NOW - 15_000,
        burstCount: PUBLIC_VIDEO_PLAYBACK_BURST_MAX,
        sustainedWindowStartedAt: NOW - 15_000,
        sustainedCount: 40,
      },
    });

    assert.equal(decision.allowed, false);
    assert.equal(
      decision.retryAfterMs,
      PUBLIC_VIDEO_PLAYBACK_BURST_WINDOW_MS - 15_000
    );
    assert.equal(
      decision.nextState.burstCount,
      PUBLIC_VIDEO_PLAYBACK_BURST_MAX
    );
  });

  it('bloqueia pela janela sustentada mesmo com burst disponível', () => {
    const decision = buildPublicVideoPlaybackRateLimitDecision({
      now: NOW,
      state: {
        burstWindowStartedAt: NOW - 5_000,
        burstCount: 1,
        sustainedWindowStartedAt: NOW - 120_000,
        sustainedCount: PUBLIC_VIDEO_PLAYBACK_SUSTAINED_MAX,
      },
    });

    assert.equal(decision.allowed, false);
    assert.equal(
      decision.retryAfterMs,
      PUBLIC_VIDEO_PLAYBACK_SUSTAINED_WINDOW_MS - 120_000
    );
  });

  it('reinicia janelas expiradas sem carregar contadores antigos', () => {
    const decision = buildPublicVideoPlaybackRateLimitDecision({
      now: NOW,
      state: {
        burstWindowStartedAt: NOW - PUBLIC_VIDEO_PLAYBACK_BURST_WINDOW_MS,
        burstCount: PUBLIC_VIDEO_PLAYBACK_BURST_MAX,
        sustainedWindowStartedAt:
          NOW - PUBLIC_VIDEO_PLAYBACK_SUSTAINED_WINDOW_MS,
        sustainedCount: PUBLIC_VIDEO_PLAYBACK_SUSTAINED_MAX,
      },
    });

    assert.equal(decision.allowed, true);
    assert.deepEqual(decision.nextState, {
      burstWindowStartedAt: NOW,
      burstCount: 1,
      sustainedWindowStartedAt: NOW,
      sustainedCount: 1,
    });
  });

  it('recupera de relógio persistido no futuro em vez de bloquear indefinidamente', () => {
    const decision = buildPublicVideoPlaybackRateLimitDecision({
      now: NOW,
      state: {
        burstWindowStartedAt: NOW + 60_000,
        burstCount: PUBLIC_VIDEO_PLAYBACK_BURST_MAX,
        sustainedWindowStartedAt: NOW + 60_000,
        sustainedCount: PUBLIC_VIDEO_PLAYBACK_SUSTAINED_MAX,
      },
    });

    assert.equal(decision.allowed, true);
    assert.equal(decision.nextState.burstWindowStartedAt, NOW);
    assert.equal(decision.nextState.sustainedWindowStartedAt, NOW);
  });
});
