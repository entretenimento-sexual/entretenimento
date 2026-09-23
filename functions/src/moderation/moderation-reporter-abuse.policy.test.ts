import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  evaluateModerationReporterAbuse,
  minorSafetyReportRateLimitConfig,
} from './moderation-reporter-abuse.policy';

describe('moderation-reporter-abuse.policy', () => {
  it('keeps sparse or mixed history normal', () => {
    assert.equal(evaluateModerationReporterAbuse({
      reviewedReports: 3,
      rejectedReports: 3,
      confirmedReports: 0,
    }).level, 'NORMAL');

    assert.equal(evaluateModerationReporterAbuse({
      reviewedReports: 8,
      rejectedReports: 5,
      confirmedReports: 3,
    }).level, 'NORMAL');
  });

  it('raises friction only after repeated rejected reports', () => {
    assert.equal(evaluateModerationReporterAbuse({
      reviewedReports: 4,
      rejectedReports: 3,
      confirmedReports: 1,
    }).level, 'ELEVATED');

    assert.equal(evaluateModerationReporterAbuse({
      reviewedReports: 8,
      rejectedReports: 7,
      confirmedReports: 0,
    }).level, 'HIGH');
  });

  it('never creates a zero-capacity reporting tier', () => {
    for (const level of ['NORMAL', 'ELEVATED', 'HIGH'] as const) {
      const config = minorSafetyReportRateLimitConfig(level);
      assert.ok(config.burstMax > 0);
      assert.ok(config.sustainedMax > 0);
    }
  });
});
