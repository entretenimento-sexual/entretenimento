import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_MODERATION_AUTOMATION_THRESHOLDS,
  evaluateModerationAutomation,
} from './moderation-automation.policy';

describe('moderation automation enforcement invariants', () => {
  it('não transforma denúncias brutas em suspensão', () => {
    const decision = evaluateModerationAutomation({
      mode: 'ENFORCE',
      signals: {
        openReports: 500,
        openCriticalReports: 100,
        quarantinedDistinctTargets: 0,
        uniqueReporters: 500,
        confirmedViolations: 0,
        confirmedCriticalViolations: 0,
      },
    });

    assert.notEqual(decision.action, 'SUSPEND_CONFIRMED');
    assert.equal(decision.enforce, false);
  });

  it('hold exige alvos distintos e denunciantes independentes', () => {
    const below = evaluateModerationAutomation({
      mode: 'ENFORCE',
      signals: {
        openReports: 20,
        openCriticalReports: 0,
        quarantinedDistinctTargets:
          DEFAULT_MODERATION_AUTOMATION_THRESHOLDS.holdQuarantinedTargets,
        uniqueReporters:
          DEFAULT_MODERATION_AUTOMATION_THRESHOLDS.holdUniqueReporters - 1,
        confirmedViolations: 0,
        confirmedCriticalViolations: 0,
      },
    });

    assert.notEqual(below.action, 'TEMPORARY_INTERACTION_HOLD');
  });

  it('uma violação crítica só suspende depois de confirmada', () => {
    const beforeReview = evaluateModerationAutomation({
      mode: 'ENFORCE',
      signals: {
        openReports: 1,
        openCriticalReports: 1,
        quarantinedDistinctTargets: 1,
        uniqueReporters: 1,
        confirmedViolations: 0,
        confirmedCriticalViolations: 0,
      },
    });
    const afterReview = evaluateModerationAutomation({
      mode: 'ENFORCE',
      signals: {
        openReports: 0,
        openCriticalReports: 0,
        quarantinedDistinctTargets: 1,
        uniqueReporters: 1,
        confirmedViolations: 1,
        confirmedCriticalViolations: 1,
      },
    });

    assert.notEqual(beforeReview.action, 'SUSPEND_CONFIRMED');
    assert.equal(afterReview.action, 'SUSPEND_CONFIRMED');
    assert.equal(afterReview.enforce, true);
  });
});
