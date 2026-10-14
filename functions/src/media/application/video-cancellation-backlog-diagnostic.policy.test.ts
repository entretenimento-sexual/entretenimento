import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  summarizeCancellationBacklogSample,
} from './video-cancellation-backlog-diagnostic.policy';

const now = 1_800_000_000_000;

test('sample distinguishes overdue backlog without asserting scheduler uptime', () => {
  const summary = summarizeCancellationBacklogSample([
    {
      state: 'CANCEL_REQUESTED',
      cancelRequestedAt: now - 25 * 60 * 60_000,
      nextAttemptAt: now - 10_000,
    },
    {
      state: 'CANCEL_REQUESTED',
      cancelRequestedAt: now - 25 * 60 * 60_000,
      nextAttemptAt: now + 10_000,
    },
    {
      state: 'CANCEL_REQUESTED',
      cancelRequestedAt: now - 25 * 60 * 60_000,
    },
    { state: 'SUCCEEDED', nextAttemptAt: now - 1 },
  ], now, 5);

  assert.deepEqual(summary, {
    verification: 'UNVERIFIED',
    scheduleMinutes: 30,
    sampled: 3,
    due: 1,
    overdue24h: 1,
    missingOrInvalidDue: 1,
    samplePartial: true,
  });
});

test('empty sample does not pretend full coverage when cancellations exist', () => {
  const diagnostic = summarizeCancellationBacklogSample([], now, 2);
  assert.equal(diagnostic.due, 0);
  assert.equal(diagnostic.samplePartial, true);
  assert.equal(diagnostic.verification, 'UNVERIFIED');
});

test('future and corrupted timestamps cannot fabricate scheduler failures', () => {
  const diagnostic = summarizeCancellationBacklogSample([
    { state: 'CANCEL_REQUESTED', nextAttemptAt: -1 },
    { state: 'CANCEL_REQUESTED', nextAttemptAt: 'tomorrow' },
    {
      state: 'CANCEL_REQUESTED',
      nextAttemptAt: now - 1,
      cancelRequestedAt: now + 1,
    },
  ], now, 3);
  assert.equal(diagnostic.missingOrInvalidDue, 2);
  assert.equal(diagnostic.due, 1);
  assert.equal(diagnostic.overdue24h, 0);
  assert.equal(diagnostic.samplePartial, false);
});

test('frontend never equates Transcoder reachability with scheduler health', () => {
  const component = readFileSync(resolve(
    __dirname,
    '../../../../src/app/admin-dashboard/video-moderation/video-moderation.component.ts'
  ), 'utf8');
  const template = readFileSync(resolve(
    __dirname,
    '../../../../src/app/admin-dashboard/video-moderation/video-moderation.component.html'
  ), 'utf8');
  assert.ok(component.includes("return 'Transcoder acessível';"));
  assert.ok(template.includes('Execução do scheduler não verificada'));
  assert.ok(template.includes('cancellation.samplePartial'));
  assert.ok(template.includes('cancellation.missingOrInvalidDue'));
});
