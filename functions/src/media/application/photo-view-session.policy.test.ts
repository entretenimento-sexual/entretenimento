import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  PHOTO_VIEW_MIN_VISIBLE_MS,
  PHOTO_VIEW_SESSION_RATE_WINDOW_MS,
  buildPhotoViewSessionRateDecision,
  normalizePhotoViewEvidence,
  normalizePhotoViewSessionToken,
} from './photo-view-session.policy';

describe('photo-view-session.policy', () => {
  it('aceita apenas token opaco no formato esperado', () => {
    assert.equal(normalizePhotoViewSessionToken('curto'), '');
    assert.equal(normalizePhotoViewSessionToken('a'.repeat(32)), 'a'.repeat(32));
    assert.equal(normalizePhotoViewSessionToken(`${'a'.repeat(31)}/`), '');
    assert.equal(normalizePhotoViewSessionToken('a'.repeat(129)), '');
  });

  it('exige permanência mínima e timestamp de qualificação', () => {
    const sessionId = 'a'.repeat(32);

    assert.equal(normalizePhotoViewEvidence({
      sessionId,
      visibleMs: PHOTO_VIEW_MIN_VISIBLE_MS - 1,
      qualifiedAt: 1_800_000_000_000,
    }), null);

    assert.deepEqual(normalizePhotoViewEvidence({
      sessionId,
      visibleMs: PHOTO_VIEW_MIN_VISIBLE_MS,
      qualifiedAt: 1_800_000_000_000,
    }), {
      sessionId,
      visibleMs: PHOTO_VIEW_MIN_VISIBLE_MS,
      qualifiedAt: 1_800_000_000_000,
    });
  });

  it('autoriza primeira emissão e incrementa a janela', () => {
    const now = 1_800_000_000_000;
    const decision = buildPhotoViewSessionRateDecision({
      now,
      state: null,
      maxPerWindow: 10,
    });

    assert.equal(decision.allowed, true);
    assert.deepEqual(decision.nextState, {
      windowStartedAt: now,
      count: 1,
      lastIssuedAt: now,
    });
  });

  it('bloqueia rajada e informa o intervalo restante', () => {
    const now = 1_800_000_000_000;
    const decision = buildPhotoViewSessionRateDecision({
      now: now + 500,
      state: {
        windowStartedAt: now,
        count: 1,
        lastIssuedAt: now,
      },
      maxPerWindow: 10,
    });

    assert.equal(decision.allowed, false);
    assert.equal(decision.retryAfterMs, 500);
    assert.equal(decision.nextState.count, 1);
  });

  it('bloqueia ao atingir o teto da janela', () => {
    const now = 1_800_000_000_000;
    const decision = buildPhotoViewSessionRateDecision({
      now: now + 30_000,
      state: {
        windowStartedAt: now,
        count: 10,
        lastIssuedAt: now,
      },
      maxPerWindow: 10,
    });

    assert.equal(decision.allowed, false);
    assert.equal(
      decision.retryAfterMs,
      PHOTO_VIEW_SESSION_RATE_WINDOW_MS - 30_000
    );
  });

  it('reinicia uma janela expirada', () => {
    const now = 1_800_000_000_000;
    const nextWindow = now + PHOTO_VIEW_SESSION_RATE_WINDOW_MS;
    const decision = buildPhotoViewSessionRateDecision({
      now: nextWindow,
      state: {
        windowStartedAt: now,
        count: 99,
        lastIssuedAt: now,
      },
      maxPerWindow: 10,
    });

    assert.equal(decision.allowed, true);
    assert.deepEqual(decision.nextState, {
      windowStartedAt: nextWindow,
      count: 1,
      lastIssuedAt: nextWindow,
    });
  });
});
