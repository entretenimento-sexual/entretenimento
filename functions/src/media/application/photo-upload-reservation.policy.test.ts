import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PHOTO_UPLOAD_MAX_BYTES_PER_WINDOW,
  PHOTO_UPLOAD_MAX_RESERVATIONS_PER_WINDOW,
  PHOTO_UPLOAD_QUOTA_WINDOW_MS,
  evaluatePhotoUploadQuota,
} from './photo-upload-reservation.policy';

test('photo upload quota reserves count and bytes atomically in one state', () => {
  const decision = evaluatePhotoUploadQuota(null, 2_000_000, 1_000);
  assert.equal(decision.allowed, true);
  if (!decision.allowed) return;
  assert.equal(decision.nextState.reservedCount, 1);
  assert.equal(decision.nextState.reservedBytes, 2_000_000);
});

test('photo upload quota rejects count exhaustion', () => {
  const decision = evaluatePhotoUploadQuota(
    {
      windowStartedAtMs: 0,
      reservedCount: PHOTO_UPLOAD_MAX_RESERVATIONS_PER_WINDOW,
      reservedBytes: 0,
    },
    1,
    1_000
  );
  assert.equal(decision.allowed, false);
  if (decision.allowed) return;
  assert.equal(decision.reason, 'reservation_count_exceeded');
  assert.ok(decision.retryAfterMs > 0);
});

test('photo upload quota rejects byte exhaustion', () => {
  const decision = evaluatePhotoUploadQuota(
    {
      windowStartedAtMs: 0,
      reservedCount: 0,
      reservedBytes: PHOTO_UPLOAD_MAX_BYTES_PER_WINDOW,
    },
    1,
    1_000
  );
  assert.equal(decision.allowed, false);
  if (decision.allowed) return;
  assert.equal(decision.reason, 'reserved_bytes_exceeded');
});

test('photo upload quota resets on the next window', () => {
  const now = PHOTO_UPLOAD_QUOTA_WINDOW_MS + 1_000;
  const decision = evaluatePhotoUploadQuota(
    {
      windowStartedAtMs: 0,
      reservedCount: PHOTO_UPLOAD_MAX_RESERVATIONS_PER_WINDOW,
      reservedBytes: PHOTO_UPLOAD_MAX_BYTES_PER_WINDOW,
    },
    1024,
    now
  );
  assert.equal(decision.allowed, true);
  if (!decision.allowed) return;
  assert.equal(decision.nextState.reservedCount, 1);
  assert.equal(decision.nextState.reservedBytes, 1024);
});
