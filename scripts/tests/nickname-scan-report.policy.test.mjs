import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  shouldInspectNextDocument, buildNicknameScanReport,
} from '../maintenance/nickname-scan-report.policy.mjs';

const timestamps = {
  startedAt: '2026-11-02T12:00:00.000Z',
  completedAt: '2026-11-02T12:05:00.000Z',
};
test('a full page needs one extra read to determine real completion', () => {
  assert.equal(shouldInspectNextDocument({ scanned: 100, limit: 100 }), true);
  assert.equal(shouldInspectNextDocument({ scanned: 99, limit: 100 }), false);
  assert.throws(() => shouldInspectNextDocument({ scanned: 101, limit: 100 }));
});
test('read-only inventory output is directly consumable JSON', () => {
  const output = buildNicknameScanReport({
    ...timestamps, projectId: 'demo-entretenimento', mode: 'READ_ONLY',
    limit: 100, truncated: false, counters: {
      scannedUsers: 100, completedUsers: 90, review: 0, flags: { MISSING_RESERVATION: 0 },
    }, gate: { inventoryClean: true, reasons: [] },
  });
  const parsed = JSON.parse(JSON.stringify(output));
  assert.equal(parsed.scannedUsers, 100);
  assert.equal(parsed.truncated, false);
  assert.equal(parsed.mode, 'READ_ONLY');
  assert.deepEqual(parsed.flags, { MISSING_RESERVATION: 0 });
});
test('dry-run index output uses the same contract', () => {
  const result = buildNicknameScanReport({
    ...timestamps, projectId: 'demo-entretenimento', mode: 'DRY_RUN',
    limit: 100, truncated: true, counters: {
      scanned: 100, candidate: 12, already: 88, invalid: 0,
      conflict: 0, applied: 0, changedDuringTransaction: 0,
    },
  });
  assert.equal(result.candidate, 12);
  assert.equal(result.truncated, true);
});
test('private identifiers and arbitrary free text are never exported', () => {
  assert.throws(() => buildNicknameScanReport({
    ...timestamps, projectId: 'demo-entretenimento', mode: 'READ_ONLY',
    limit: 100, truncated: false, counters: {
      scannedUsers: 100, nickname: 'private-user',
    },
  }), /aggregate numeric counters/);
  assert.throws(() => buildNicknameScanReport({
    ...timestamps, projectId: 'demo-entretenimento', mode: 'READ_ONLY',
    limit: 100, truncated: false, counters: {
      flags: { EMAIL_OWNER_UID: -1 },
    },
  }), /Invalid aggregate flag/);
});
