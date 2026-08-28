import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PUBLIC_VIDEO_ACCESS_BURST_MAX_ITEMS,
  PUBLIC_VIDEO_ACCESS_BURST_WINDOW_MS,
  PUBLIC_VIDEO_ACCESS_SUSTAINED_MAX_ITEMS,
  PUBLIC_VIDEO_ACCESS_SUSTAINED_WINDOW_MS,
  buildPublicVideoAccessRateLimitDecision,
  type PublicVideoAccessRateLimitState,
} from './public-video-access-rate-limit';

const NOW = 1_800_000_000_000;

describe('public-video-access-rate-limit', () => {
  it('pondera a quota pela quantidade de vídeos únicos solicitados', () => {
    let state: PublicVideoAccessRateLimitState | null = null;

    for (let page = 0; page < 8; page += 1) {
      const decision = buildPublicVideoAccessRateLimitDecision({
        now: NOW,
        itemCount: 12,
        state,
      });

      assert.equal(decision.allowed, true);
      state = decision.nextState;
    }

    assert.equal(state?.burstCount, PUBLIC_VIDEO_ACCESS_BURST_MAX_ITEMS);

    const blocked = buildPublicVideoAccessRateLimitDecision({
      now: NOW,
      itemCount: 1,
      state,
    });

    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterMs, PUBLIC_VIDEO_ACCESS_BURST_WINDOW_MS);
  });

  it('não incrementa os contadores quando o lote excede a janela disponível', () => {
    const state: PublicVideoAccessRateLimitState = {
      burstWindowStartedAt: NOW,
      burstCount: PUBLIC_VIDEO_ACCESS_BURST_MAX_ITEMS - 8,
      sustainedWindowStartedAt: NOW,
      sustainedCount: 200,
    };

    const decision = buildPublicVideoAccessRateLimitDecision({
      now: NOW + 1_000,
      itemCount: 12,
      state,
    });

    assert.equal(decision.allowed, false);
    assert.equal(
      decision.nextState.burstCount,
      PUBLIC_VIDEO_ACCESS_BURST_MAX_ITEMS - 8
    );
    assert.equal(decision.nextState.sustainedCount, 200);
  });

  it('aplica também a janela sustentada mesmo com burst disponível', () => {
    const state: PublicVideoAccessRateLimitState = {
      burstWindowStartedAt: NOW,
      burstCount: 0,
      sustainedWindowStartedAt: NOW,
      sustainedCount: PUBLIC_VIDEO_ACCESS_SUSTAINED_MAX_ITEMS - 8,
    };

    const decision = buildPublicVideoAccessRateLimitDecision({
      now: NOW + 2_000,
      itemCount: 12,
      state,
    });

    assert.equal(decision.allowed, false);
    assert.equal(
      decision.retryAfterMs,
      PUBLIC_VIDEO_ACCESS_SUSTAINED_WINDOW_MS - 2_000
    );
  });

  it('reinicia janelas expiradas sem carregar contagem antiga', () => {
    const decision = buildPublicVideoAccessRateLimitDecision({
      now: NOW,
      itemCount: 12,
      state: {
        burstWindowStartedAt: NOW - PUBLIC_VIDEO_ACCESS_BURST_WINDOW_MS,
        burstCount: PUBLIC_VIDEO_ACCESS_BURST_MAX_ITEMS,
        sustainedWindowStartedAt:
          NOW - PUBLIC_VIDEO_ACCESS_SUSTAINED_WINDOW_MS,
        sustainedCount: PUBLIC_VIDEO_ACCESS_SUSTAINED_MAX_ITEMS,
      },
    });

    assert.equal(decision.allowed, true);
    assert.equal(decision.nextState.burstWindowStartedAt, NOW);
    assert.equal(decision.nextState.burstCount, 12);
    assert.equal(decision.nextState.sustainedWindowStartedAt, NOW);
    assert.equal(decision.nextState.sustainedCount, 12);
  });
});
