// functions/src/community-boost/community-boost-cost-calibration.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY BOOST COST CALIBRATION
// -----------------------------------------------------------------------------
// Mede custo financeiro REAL atribuído ao Boost. Não propõe CPM nem altera a
// configuração ativa; somente libera análise quando existe baseline operacional
// de produção e custo realizado vindo de billing/finanças.
// -----------------------------------------------------------------------------

import {
  evaluateCommunityOperationalCostBaseline,
  type CommunityOperationalCostBaselineInput,
} from '../shared/observability/operational-cost-baseline.policy';

export type CommunityBoostCostCalibrationStatus =
  | 'invalid_observation'
  | 'no_delivery_observation'
  | 'actual_cost_missing'
  | 'actual_cost_source_invalid'
  | 'operational_baseline_not_ready'
  | 'observed';

export interface CommunityBoostCostCalibrationInput {
  readonly servedPlacements: unknown;
  readonly actualAttributedCostCents: unknown;
  readonly actualCostSource: unknown;
  readonly operationalBaseline: CommunityOperationalCostBaselineInput;
}

export interface CommunityBoostCostCalibrationSnapshot {
  readonly servedPlacements: number;
  readonly actualAttributedCostCents: number | null;
  readonly actualCostPerThousandServedCents: number | null;
  readonly status: CommunityBoostCostCalibrationStatus;
  readonly canCalibrateBoostCost: boolean;
}

function count(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= 0
    ? value
    : null;
}

export function evaluateCommunityBoostCostCalibration(
  input: CommunityBoostCostCalibrationInput
): Readonly<CommunityBoostCostCalibrationSnapshot> {
  const servedPlacements = count(input.servedPlacements);
  const actualCost = count(input.actualAttributedCostCents);

  if (servedPlacements === null) {
    return Object.freeze({
      servedPlacements: 0,
      actualAttributedCostCents: actualCost,
      actualCostPerThousandServedCents: null,
      status: 'invalid_observation',
      canCalibrateBoostCost: false,
    });
  }

  if (servedPlacements === 0) {
    return Object.freeze({
      servedPlacements,
      actualAttributedCostCents: actualCost,
      actualCostPerThousandServedCents: null,
      status: 'no_delivery_observation',
      canCalibrateBoostCost: false,
    });
  }

  if (actualCost === null) {
    return Object.freeze({
      servedPlacements,
      actualAttributedCostCents: null,
      actualCostPerThousandServedCents: null,
      status: 'actual_cost_missing',
      canCalibrateBoostCost: false,
    });
  }

  if (
    input.actualCostSource !== 'cloud_billing_export'
    && input.actualCostSource !== 'finance_actual_allocation'
  ) {
    return Object.freeze({
      servedPlacements,
      actualAttributedCostCents: actualCost,
      actualCostPerThousandServedCents: null,
      status: 'actual_cost_source_invalid',
      canCalibrateBoostCost: false,
    });
  }

  const baseline = evaluateCommunityOperationalCostBaseline(
    input.operationalBaseline
  );
  if (!baseline.ready) {
    return Object.freeze({
      servedPlacements,
      actualAttributedCostCents: actualCost,
      actualCostPerThousandServedCents: null,
      status: 'operational_baseline_not_ready',
      canCalibrateBoostCost: false,
    });
  }

  return Object.freeze({
    servedPlacements,
    actualAttributedCostCents: actualCost,
    actualCostPerThousandServedCents:
      Math.round((actualCost / servedPlacements) * 100_000) / 100,
    status: 'observed',
    canCalibrateBoostCost: true,
  });
}
