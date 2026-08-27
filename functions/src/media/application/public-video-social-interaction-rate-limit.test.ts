import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PUBLIC_VIDEO_COMMENT_RATE_LIMIT_CONFIG,
  PUBLIC_VIDEO_RATING_RATE_LIMIT_CONFIG,
  PUBLIC_VIDEO_REACTION_RATE_LIMIT_CONFIG,
  buildPublicVideoSocialInteractionRateLimitDecision,
  type PublicVideoSocialInteractionKind,
  type PublicVideoSocialInteractionRateLimitState,
} from './public-video-social-interaction-rate-limit';

const NOW = 1_800_000_000_000;

function assertBurstLimit(
  kind: PublicVideoSocialInteractionKind,
  max: number,
  windowMs: number
): void {
  let state: PublicVideoSocialInteractionRateLimitState | null = null;

  for (let index = 0; index < max; index += 1) {
    const decision = buildPublicVideoSocialInteractionRateLimitDecision({
      now: NOW,
      kind,
      state,
    });

    assert.equal(decision.allowed, true);
    state = decision.nextState;
  }

  const blocked = buildPublicVideoSocialInteractionRateLimitDecision({
    now: NOW,
    kind,
    state,
  });

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterMs, windowMs);
}

describe('public-video-social-interaction-rate-limit', () => {
  it('limita reações sem competir com a quota de playback', () => {
    assertBurstLimit(
      'reaction',
      PUBLIC_VIDEO_REACTION_RATE_LIMIT_CONFIG.burstMax,
      PUBLIC_VIDEO_REACTION_RATE_LIMIT_CONFIG.burstWindowMs
    );
  });

  it('mantém comentários no teto humano já adotado para denúncias', () => {
    assertBurstLimit(
      'comment',
      PUBLIC_VIDEO_COMMENT_RATE_LIMIT_CONFIG.burstMax,
      PUBLIC_VIDEO_COMMENT_RATE_LIMIT_CONFIG.burstWindowMs
    );
  });

  it('limita avaliações entre comentário e reação', () => {
    assertBurstLimit(
      'rating',
      PUBLIC_VIDEO_RATING_RATE_LIMIT_CONFIG.burstMax,
      PUBLIC_VIDEO_RATING_RATE_LIMIT_CONFIG.burstWindowMs
    );
  });

  it('aplica a janela sustentada independentemente do burst disponível', () => {
    const config = PUBLIC_VIDEO_COMMENT_RATE_LIMIT_CONFIG;
    const decision = buildPublicVideoSocialInteractionRateLimitDecision({
      now: NOW + 2_000,
      kind: 'comment',
      state: {
        burstWindowStartedAt: NOW,
        burstCount: 0,
        sustainedWindowStartedAt: NOW,
        sustainedCount: config.sustainedMax,
      },
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.retryAfterMs, config.sustainedWindowMs - 2_000);
  });

  it('reinicia as duas janelas expiradas sem carregar contagem anterior', () => {
    const config = PUBLIC_VIDEO_RATING_RATE_LIMIT_CONFIG;
    const decision = buildPublicVideoSocialInteractionRateLimitDecision({
      now: NOW,
      kind: 'rating',
      state: {
        burstWindowStartedAt: NOW - config.burstWindowMs,
        burstCount: config.burstMax,
        sustainedWindowStartedAt: NOW - config.sustainedWindowMs,
        sustainedCount: config.sustainedMax,
      },
    });

    assert.equal(decision.allowed, true);
    assert.equal(decision.nextState.burstWindowStartedAt, NOW);
    assert.equal(decision.nextState.burstCount, 1);
    assert.equal(decision.nextState.sustainedWindowStartedAt, NOW);
    assert.equal(decision.nextState.sustainedCount, 1);
  });
});
