import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MODERATION_REPORTER_ABUSE_WINDOW_MS,
  applyModerationReporterOutcome,
  moderationReportRateLimitCost,
  moderationReporterAbuseRisk,
  normalizeModerationReporterAbuseState,
} from './moderation-reporter-abuse.policy';

test('reporter risk stays normal before repeated rejected reports', () => {
  const nowMs = 1_800_000_000_000;
  let state = normalizeModerationReporterAbuseState({ nowMs });

  for (let index = 0; index < 2; index += 1) {
    state = applyModerationReporterOutcome({
      state,
      nowMs: nowMs + index,
      confirmed: false,
    }).state;
  }

  assert.equal(moderationReporterAbuseRisk(state), 'NORMAL');
  assert.equal(moderationReportRateLimitCost('NORMAL'), 1);
});

test('three rejected reports without confirmation elevate only rate-limit risk', () => {
  const nowMs = 1_800_000_000_000;
  let state = normalizeModerationReporterAbuseState({ nowMs });

  for (let index = 0; index < 3; index += 1) {
    state = applyModerationReporterOutcome({
      state,
      nowMs: nowMs + index,
      confirmed: false,
    }).state;
  }

  assert.equal(moderationReporterAbuseRisk(state), 'ELEVATED');
  assert.equal(moderationReportRateLimitCost('ELEVATED'), 2);
});

test('a confirmed report prevents false-report-only elevation', () => {
  const nowMs = 1_800_000_000_000;
  let state = normalizeModerationReporterAbuseState({ nowMs });

  state = applyModerationReporterOutcome({
    state,
    nowMs,
    confirmed: true,
  }).state;

  for (let index = 0; index < 4; index += 1) {
    state = applyModerationReporterOutcome({
      state,
      nowMs: nowMs + index + 1,
      confirmed: false,
    }).state;
  }

  assert.equal(moderationReporterAbuseRisk(state), 'NORMAL');
});

test('expired abuse window resets reporter counters', () => {
  const nowMs = 1_800_000_000_000;
  const state = normalizeModerationReporterAbuseState({
    nowMs,
    state: {
      windowStartedAtMs:
        nowMs - MODERATION_REPORTER_ABUSE_WINDOW_MS - 1,
      rejectedReports: 99,
      confirmedReports: 0,
    },
  });

  assert.deepEqual(state, {
    windowStartedAtMs: nowMs,
    rejectedReports: 0,
    confirmedReports: 0,
  });
});
