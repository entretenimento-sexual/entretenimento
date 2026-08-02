import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import './admin-authorization.policy.test';
import './media-callable-rate-limit.policy.test';
import './media-mutation-idempotency.policy.test';
import './photo-audience-access.policy.test';
import './photo-ranking-backfill.policy.test';
import './photo-ranking-score.test';
import './photo-view-session.policy.test';
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

  it('bloqueia emissões rápidas para o mesmo escopo', () => {
    const now = 1_800_000_000_000;
    const decision = buildVideoViewSessionRateDecision({
      now: now + VIDEO_VIEW_SESSION_MIN_INTERVAL_MS - 1,
      state: {
        windowStartedAt: now,
        count: 1,
        lastIssuedAt: now,
      },
      maxPerWindow: 6,
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.retryAfterMs, 1);
    assert.equal(decision.nextState.count, 1);
  });

  it('bloqueia ao atingir o máximo da janela', () => {
    const now = 1_800_000_000_000;
    const decision = buildVideoViewSessionRateDecision({
      now: now + 30_000,
      state: {
        windowStartedAt: now,
        count: 6,
        lastIssuedAt: now,
      },
      maxPerWindow: 6,
    });

    assert.equal(decision.allowed, false);
    assert.equal(
      decision.retryAfterMs,
      VIDEO_VIEW_SESSION_RATE_WINDOW_MS - 30_000
    );
  });

  it('reinicia a janela expirada', () => {
    const now = 1_800_000_000_000;
    const nextWindow = now + VIDEO_VIEW_SESSION_RATE_WINDOW_MS;
    const decision = buildVideoViewSessionRateDecision({
      now: nextWindow,
      state: {
        windowStartedAt: now,
        count: 99,
        lastIssuedAt: now,
      },
      maxPerWindow: 6,
    });

    assert.equal(decision.allowed, true);
    assert.deepEqual(decision.nextState, {
      windowStartedAt: nextWindow,
      count: 1,
      lastIssuedAt: nextWindow,
    });
  });
});
