import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  VIDEO_UPLOAD_MAX_BYTES_PER_WINDOW,
  VIDEO_UPLOAD_MAX_RESERVATIONS_PER_WINDOW,
  VIDEO_UPLOAD_QUOTA_WINDOW_MS,
  evaluateVideoUploadQuota,
  normalizeVideoUploadQuotaState,
} from './video-upload-reservation.policy';

describe('video-upload-reservation.policy', () => {
  it('reinicia quota quando muda a janela', () => {
    const now = VIDEO_UPLOAD_QUOTA_WINDOW_MS * 5 + 10;

    assert.deepEqual(
      normalizeVideoUploadQuotaState({
        windowStartedAtMs: VIDEO_UPLOAD_QUOTA_WINDOW_MS * 4,
        reservedCount: 9,
        reservedBytes: 999,
      }, now),
      {
        windowStartedAtMs: VIDEO_UPLOAD_QUOTA_WINDOW_MS * 5,
        reservedCount: 0,
        reservedBytes: 0,
      }
    );
  });

  it('contabiliza quantidade e bytes atomicamente na decisão', () => {
    const decision = evaluateVideoUploadQuota(null, 500, 10);

    assert.equal(decision.allowed, true);
    if (decision.allowed) {
      assert.equal(decision.nextState.reservedCount, 1);
      assert.equal(decision.nextState.reservedBytes, 500);
    }
  });

  it('nega excesso de reservas sem alterar estado', () => {
    const decision = evaluateVideoUploadQuota({
      windowStartedAtMs: 0,
      reservedCount: VIDEO_UPLOAD_MAX_RESERVATIONS_PER_WINDOW,
      reservedBytes: 1,
    }, 1, 10);

    assert.equal(decision.allowed, false);
    if (!decision.allowed) {
      assert.equal(decision.reason, 'reservation_count_exceeded');
      assert.equal(
        decision.nextState.reservedCount,
        VIDEO_UPLOAD_MAX_RESERVATIONS_PER_WINDOW
      );
    }
  });

  it('nega excesso de bytes sem criar crédito negativo', () => {
    const decision = evaluateVideoUploadQuota({
      windowStartedAtMs: 0,
      reservedCount: 0,
      reservedBytes: VIDEO_UPLOAD_MAX_BYTES_PER_WINDOW,
    }, 1, 10);

    assert.equal(decision.allowed, false);
    if (!decision.allowed) {
      assert.equal(decision.reason, 'reserved_bytes_exceeded');
      assert.equal(
        decision.nextState.reservedBytes,
        VIDEO_UPLOAD_MAX_BYTES_PER_WINDOW
      );
    }
  });
});
