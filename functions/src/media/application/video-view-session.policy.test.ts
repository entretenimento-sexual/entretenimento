import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import './media-callable-rate-limit.policy.test';
import './photo-audience-access.policy.test';
import {
  VIDEO_VIEW_SESSION_MIN_INTERVAL_MS,
  VIDEO_VIEW_SESSION_RATE_WINDOW_MS,
  buildVideoViewSessionRateDecision,
  normalizeVideoViewSessionToken,
} from './video-view-session.policy';

describe('video-view-session.policy', () => {
  it('aceita somente tokens opacos com tamanho e alfabeto válidos', () => {
    assert.equal(normalizeVideoViewSessionToken('curto'), '');
    assert.equal(normalizeVideoViewSessionToken('a'.repeat(32)), 'a'.repeat(32));
    assert.equal(normalizeVideoViewSessionToken(`${'a'.repeat(31)}/`), '');
    assert.equal(normalizeVideoViewSessionToken('a'.repeat(129)), '');
  });

  it('autoriza a primeira emissão e incrementa a janela', () => {
    const now = 1_800_000_000_000;
    const decision = buildVideoViewSessionRateDecision({
      now,
      state: null,
      maxPerWindow: 6,
    });

    assert.equal(decision.allowed, true);
    assert.equal(decision.retryAfterMs, 0);
    assert.deepEqual(decision.nextState, {
      windowStartedAt: now,
      count: 1,
      lastIssuedAt: now,
    });
  });

  it('aplica intervalo mínimo entre emissões', () => {
    const now = 1_800_000_000_000;
    const decision = buildVideoViewSessionRateDecision({
      now,
      state: {
        windowStartedAt: now - 1_000,
        count: 1,
        lastIssuedAt: now - 500,
      },
      maxPerWindow: 6,
    });

    assert.equal(decision.allowed, false);
    assert.equal(
      decision.retryAfterMs,
      VIDEO_VIEW_SESSION_MIN_INTERVAL_MS - 500
    );
    assert.equal(decision.nextState.count, 1);
  });

  it('bloqueia a janela cheia e informa quando pode tentar novamente', () => {
    const now = 1_800_000_000_000;
    const windowStartedAt = now - 60_000;
    const decision = buildVideoViewSessionRateDecision({
      now,
      state: {
        windowStartedAt,
        count: 6,
        lastIssuedAt: now - VIDEO_VIEW_SESSION_MIN_INTERVAL_MS,
      },
      maxPerWindow: 6,
    });

    assert.equal(decision.allowed, false);
    assert.equal(
      decision.retryAfterMs,
      VIDEO_VIEW_SESSION_RATE_WINDOW_MS - 60_000
    );
  });

  it('reinicia a contagem quando a janela expira', () => {
    const now = 1_800_000_000_000;
    const decision = buildVideoViewSessionRateDecision({
      now,
      state: {
        windowStartedAt: now - VIDEO_VIEW_SESSION_RATE_WINDOW_MS,
        count: 99,
        lastIssuedAt: now - VIDEO_VIEW_SESSION_MIN_INTERVAL_MS,
      },
      maxPerWindow: 6,
    });

    assert.equal(decision.allowed, true);
    assert.deepEqual(decision.nextState, {
      windowStartedAt: now,
      count: 1,
      lastIssuedAt: now,
    });
  });
});
