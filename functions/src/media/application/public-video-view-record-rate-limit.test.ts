import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PUBLIC_VIDEO_VIEW_RECORD_BURST_MAX,
  PUBLIC_VIDEO_VIEW_RECORD_BURST_WINDOW_MS,
  PUBLIC_VIDEO_VIEW_RECORD_SUSTAINED_MAX,
  PUBLIC_VIDEO_VIEW_RECORD_SUSTAINED_WINDOW_MS,
  buildPublicVideoViewRecordRateLimitDecision,
} from './public-video-view-record-rate-limit';

const NOW = 1_800_000_000_000;

describe('public-video-view-record-rate-limit', () => {
  it('aceita a primeira tentativa e inicializa as duas janelas', () => {
    const decision = buildPublicVideoViewRecordRateLimitDecision({
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
    const decision = buildPublicVideoViewRecordRateLimitDecision({
      now: NOW,
      state: {
        burstWindowStartedAt: NOW - 12_000,
        burstCount: PUBLIC_VIDEO_VIEW_RECORD_BURST_MAX,
        sustainedWindowStartedAt: NOW - 12_000,
        sustainedCount: 80,
      },
    });

    assert.equal(decision.allowed, false);
    assert.equal(
      decision.retryAfterMs,
      PUBLIC_VIDEO_VIEW_RECORD_BURST_WINDOW_MS - 12_000
    );
    assert.equal(
      decision.nextState.burstCount,
      PUBLIC_VIDEO_VIEW_RECORD_BURST_MAX
    );
  });

  it('bloqueia pela janela sustentada mesmo com burst disponível', () => {
    const decision = buildPublicVideoViewRecordRateLimitDecision({
      now: NOW,
      state: {
        burstWindowStartedAt: NOW - 5_000,
        burstCount: 1,
        sustainedWindowStartedAt: NOW - 120_000,
        sustainedCount: PUBLIC_VIDEO_VIEW_RECORD_SUSTAINED_MAX,
      },
    });

    assert.equal(decision.allowed, false);
    assert.equal(
      decision.retryAfterMs,
      PUBLIC_VIDEO_VIEW_RECORD_SUSTAINED_WINDOW_MS - 120_000
    );
  });

  it('reinicia janelas expiradas sem carregar contadores antigos', () => {
    const decision = buildPublicVideoViewRecordRateLimitDecision({
      now: NOW,
      state: {
        burstWindowStartedAt:
          NOW - PUBLIC_VIDEO_VIEW_RECORD_BURST_WINDOW_MS,
        burstCount: PUBLIC_VIDEO_VIEW_RECORD_BURST_MAX,
        sustainedWindowStartedAt:
          NOW - PUBLIC_VIDEO_VIEW_RECORD_SUSTAINED_WINDOW_MS,
        sustainedCount: PUBLIC_VIDEO_VIEW_RECORD_SUSTAINED_MAX,
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

  it('recupera de relógio persistido no futuro', () => {
    const decision = buildPublicVideoViewRecordRateLimitDecision({
      now: NOW,
      state: {
        burstWindowStartedAt: NOW + 60_000,
        burstCount: PUBLIC_VIDEO_VIEW_RECORD_BURST_MAX,
        sustainedWindowStartedAt: NOW + 60_000,
        sustainedCount: PUBLIC_VIDEO_VIEW_RECORD_SUSTAINED_MAX,
      },
    });

    assert.equal(decision.allowed, true);
    assert.equal(decision.nextState.burstWindowStartedAt, NOW);
    assert.equal(decision.nextState.sustainedWindowStartedAt, NOW);
  });
});
