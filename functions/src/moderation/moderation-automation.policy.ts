// functions/src/moderation/moderation-automation.policy.ts
// -----------------------------------------------------------------------------
// MODERATION AUTOMATION POLICY
// -----------------------------------------------------------------------------
// Separa sinal bruto de denúncia, ação reversível sobre conteúdo e lifecycle da
// conta. Denúncia isolada ou volume bruto nunca suspende uma conta por si só.
// -----------------------------------------------------------------------------

export type ModerationAutomationMode = 'SHADOW' | 'ENFORCE';

export type ModerationAutomationAction =
  | 'NONE'
  | 'PRIORITIZE_REVIEW'
  | 'TEMPORARY_INTERACTION_HOLD'
  | 'SUSPEND_CONFIRMED';

export interface ModerationAutomationThresholds {
  readonly reviewOpenReports: number;
  readonly reviewCriticalReports: number;
  readonly holdQuarantinedTargets: number;
  readonly holdUniqueReporters: number;
  readonly suspendConfirmedViolations: number;
  readonly suspendConfirmedCriticalViolations: number;
}

export interface ModerationAutomationSignals {
  readonly openReports: number;
  readonly openCriticalReports: number;
  readonly quarantinedDistinctTargets: number;
  readonly uniqueReporters: number;
  readonly confirmedViolations: number;
  readonly confirmedCriticalViolations: number;
}

export interface ModerationAutomationDecision {
  readonly action: ModerationAutomationAction;
  readonly enforce: boolean;
  readonly reason:
    | 'none'
    | 'report_volume'
    | 'critical_report'
    | 'multi_target_quarantine'
    | 'confirmed_recurrence'
    | 'confirmed_critical';
}

export const DEFAULT_MODERATION_AUTOMATION_THRESHOLDS:
Readonly<ModerationAutomationThresholds> = Object.freeze({
  // Estes valores servem como baseline operacional inicial e devem ser
  // recalibrados a partir de métricas reais antes de sair do shadow mode.
  reviewOpenReports: 3,
  reviewCriticalReports: 1,
  holdQuarantinedTargets: 3,
  holdUniqueReporters: 6,
  suspendConfirmedViolations: 3,
  suspendConfirmedCriticalViolations: 1,
});

function count(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.trunc(parsed)
    : 0;
}

export function evaluateModerationAutomation(input: {
  mode: ModerationAutomationMode;
  signals: ModerationAutomationSignals;
  thresholds?: ModerationAutomationThresholds;
}): Readonly<ModerationAutomationDecision> {
  const thresholds =
    input.thresholds ?? DEFAULT_MODERATION_AUTOMATION_THRESHOLDS;
  const signals = {
    openReports: count(input.signals.openReports),
    openCriticalReports: count(input.signals.openCriticalReports),
    quarantinedDistinctTargets:
      count(input.signals.quarantinedDistinctTargets),
    uniqueReporters: count(input.signals.uniqueReporters),
    confirmedViolations: count(input.signals.confirmedViolations),
    confirmedCriticalViolations:
      count(input.signals.confirmedCriticalViolations),
  };

  if (
    signals.confirmedCriticalViolations >=
      thresholds.suspendConfirmedCriticalViolations
  ) {
    return Object.freeze({
      action: 'SUSPEND_CONFIRMED',
      enforce: input.mode === 'ENFORCE',
      reason: 'confirmed_critical',
    });
  }

  if (
    signals.confirmedViolations >= thresholds.suspendConfirmedViolations
  ) {
    return Object.freeze({
      action: 'SUSPEND_CONFIRMED',
      enforce: input.mode === 'ENFORCE',
      reason: 'confirmed_recurrence',
    });
  }

  if (
    signals.quarantinedDistinctTargets >=
      thresholds.holdQuarantinedTargets &&
    signals.uniqueReporters >= thresholds.holdUniqueReporters
  ) {
    return Object.freeze({
      action: 'TEMPORARY_INTERACTION_HOLD',
      enforce: input.mode === 'ENFORCE',
      reason: 'multi_target_quarantine',
    });
  }

  if (
    signals.openCriticalReports >= thresholds.reviewCriticalReports
  ) {
    return Object.freeze({
      action: 'PRIORITIZE_REVIEW',
      enforce: false,
      reason: 'critical_report',
    });
  }

  if (signals.openReports >= thresholds.reviewOpenReports) {
    return Object.freeze({
      action: 'PRIORITIZE_REVIEW',
      enforce: false,
      reason: 'report_volume',
    });
  }

  return Object.freeze({
    action: 'NONE',
    enforce: false,
    reason: 'none',
  });
}
