import {
  evaluateModerationReporterAbuse,
  minorSafetyReportRateLimitConfig,
} from './moderation-reporter-abuse.policy';

describe('moderation reporter abuse policy', () => {
  it('keeps sparse or mixed history normal', () => {
    expect(evaluateModerationReporterAbuse({
      reviewedReports: 3,
      rejectedReports: 3,
      confirmedReports: 0,
    }).level).toBe('NORMAL');

    expect(evaluateModerationReporterAbuse({
      reviewedReports: 8,
      rejectedReports: 5,
      confirmedReports: 3,
    }).level).toBe('NORMAL');
  });

  it('raises friction only after repeated rejected reports', () => {
    expect(evaluateModerationReporterAbuse({
      reviewedReports: 4,
      rejectedReports: 3,
      confirmedReports: 1,
    }).level).toBe('ELEVATED');

    expect(evaluateModerationReporterAbuse({
      reviewedReports: 8,
      rejectedReports: 7,
      confirmedReports: 0,
    }).level).toBe('HIGH');
  });

  it('never creates a zero-capacity reporting tier', () => {
    for (const level of ['NORMAL', 'ELEVATED', 'HIGH'] as const) {
      const config = minorSafetyReportRateLimitConfig(level);
      expect(config.burstMax).toBeGreaterThan(0);
      expect(config.sustainedMax).toBeGreaterThan(0);
    }
  });
});
