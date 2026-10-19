import assert from 'node:assert/strict';
import test from 'node:test';
import { FieldValue } from 'firebase-admin/firestore';
import { withAdminTriageProjection } from './admin-video-triage.firestore';

const now = 1_800_000_000_000;

test('c18d projection follows same-write version and state', () => {
  const before = { state: 'FAILED' as const, processingVersion: 'old',
    updatedAt: now - 2 * 60 * 60_000, adminTriageTier: 2 };
  const patch = { state: 'QUEUED' as const, processingVersion: 'new', updatedAt: now };
  const result = withAdminTriageProjection('j', before, patch, now);
  assert.equal(result.adminTriageProcessingVersion, 'new');
  assert.equal(result.adminTriageTier, 5);
  assert.equal(result.adminTriageSince, now);
  assert.equal(result.adminTriageReevaluateAt, now + 20 * 60_000 + 1);
  assert.equal(before.adminTriageTier, 2);
});

test('c18d terminal or versionless transitions erase all indexed fields', () => {
  for (const patch of [{ state: 'SUCCEEDED' as const },
    { state: 'CANCELLED' as const }, { processingVersion: '' }]) {
    const result = withAdminTriageProjection('j', {
      state: 'FAILED', processingVersion: 'v1', updatedAt: now,
    }, patch, now);
    for (const field of ['adminTriageProjectionVersion',
      'adminTriageProcessingVersion', 'adminTriageTier',
      'adminTriageSince', 'adminTriageReevaluateAt']) {
      assert.ok((result[field] as FieldValue).isEqual(FieldValue.delete()), field);
    }
  }
});

test('c18d legacy missing timestamps remain explicitly unverified', () => {
  const result = withAdminTriageProjection('legacy', {
    state: 'QUEUED', processingVersion: 'v1',
  }, { nextAttemptAt: now }, now);
  assert.equal(result.adminTriageTier, 1);
  assert.equal(result.adminTriageSince, 0);
});
