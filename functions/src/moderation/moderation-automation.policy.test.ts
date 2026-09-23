import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { evaluateModerationAutomation } from './moderation-automation.policy';

const base = {
  openReports: 0,
  openCriticalReports: 0,
  quarantinedDistinctTargets: 0,
  uniqueReporters: 0,
  confirmedViolations: 0,
  confirmedCriticalViolations: 0,
};

describe('moderation-automation.policy', () => {
  it('não suspende conta por volume bruto de denúncias', () => {
    const decision = evaluateModerationAutomation({
      mode: 'ENFORCE',
      signals: {
        ...base,
        openReports: 200,
        uniqueReporters: 200,
      },
    });

    assert.equal(decision.action, 'PRIORITIZE_REVIEW');
    assert.equal(decision.enforce, false);
  });

  it('prioriza imediatamente denúncia crítica sem suspender', () => {
    const decision = evaluateModerationAutomation({
      mode: 'ENFORCE',
      signals: {
        ...base,
        openCriticalReports: 1,
      },
    });

    assert.equal(decision.action, 'PRIORITIZE_REVIEW');
    assert.equal(decision.reason, 'critical_report');
    assert.equal(decision.enforce, false);
  });

  it('pode sugerir hold por múltiplos alvos e denunciantes independentes', () => {
    const decision = evaluateModerationAutomation({
      mode: 'SHADOW',
      signals: {
        ...base,
        quarantinedDistinctTargets: 3,
        uniqueReporters: 6,
      },
    });

    assert.equal(decision.action, 'TEMPORARY_INTERACTION_HOLD');
    assert.equal(decision.enforce, false);
  });

  it('suspensão depende de infração confirmada e respeita shadow mode', () => {
    const shadow = evaluateModerationAutomation({
      mode: 'SHADOW',
      signals: {
        ...base,
        confirmedCriticalViolations: 1,
      },
    });
    const enforce = evaluateModerationAutomation({
      mode: 'ENFORCE',
      signals: {
        ...base,
        confirmedCriticalViolations: 1,
      },
    });

    assert.equal(shadow.action, 'SUSPEND_CONFIRMED');
    assert.equal(shadow.enforce, false);
    assert.equal(enforce.action, 'SUSPEND_CONFIRMED');
    assert.equal(enforce.enforce, true);
  });
});
