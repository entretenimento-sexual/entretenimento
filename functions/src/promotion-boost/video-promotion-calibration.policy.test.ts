import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PRODUCT_CALIBRATION_REQUIRED_EVIDENCE,
} from '../shared/calibration/product-calibration-stage.policy';
import {
  VIDEO_PROMOTION_CALIBRATION_POLICY_VERSION,
  VIDEO_PROMOTION_CALIBRATION_STAGE,
  VIDEO_PROMOTION_OBSERVATION_SOURCE,
  VIDEO_PROMOTION_RUNTIME_ENABLEMENT,
  isVideoPromotionCalibrationChangeReviewable,
  isVideoPromotionExitEvidenceReady,
} from './video-promotion-calibration.policy';

function readyEvidence(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const observedDays =
    PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.minimumObservedDaysPerRuntimeMetric;
  const runtimeSamples =
    PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.minimumRuntimeSamplesPerMetric;

  return {
    policyVersion: VIDEO_PROMOTION_CALIBRATION_POLICY_VERSION,
    observationSource: VIDEO_PROMOTION_OBSERVATION_SOURCE,
    realDataQualified: true,
    productionWindowDays:
      PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.minimumProductionWindowDays,
    cost: {
      observedDays,
      runtimeSamples,
      sufficient: true,
      financialActualsComplete: true,
    },
    consumption: {
      observedDays,
      runtimeSamples,
      sufficient: true,
      commercialUtilizationObserved: true,
    },
    abuse: {
      observedDays,
      runtimeSamples,
      sufficient: true,
      abuseSignalsObserved: true,
      reviewComplete: true,
    },
    reviewedAt: Date.UTC(2026, 8, 28, 20, 0, 0),
    reviewedBy: 'promotion_review_board',
    ...overrides,
  };
}

test('Promotion de Vídeo permanece em OBSERVE_ONLY e runtime desligado', () => {
  assert.equal(VIDEO_PROMOTION_CALIBRATION_STAGE, 'OBSERVE_ONLY');
  assert.equal(VIDEO_PROMOTION_RUNTIME_ENABLEMENT, false);
});

test('evidência completa de custo, consumo e abuso torna somente a revisão elegível', () => {
  const evidence = readyEvidence();

  assert.equal(isVideoPromotionExitEvidenceReady(evidence), true);
  assert.equal(isVideoPromotionCalibrationChangeReviewable(evidence), true);
  assert.equal(VIDEO_PROMOTION_RUNTIME_ENABLEMENT, false);
});

test('custo incompleto impede saída de OBSERVE_ONLY', () => {
  const evidence = readyEvidence({
    cost: {
      observedDays:
        PRODUCT_CALIBRATION_REQUIRED_EVIDENCE
          .minimumObservedDaysPerRuntimeMetric,
      runtimeSamples:
        PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.minimumRuntimeSamplesPerMetric,
      sufficient: true,
      financialActualsComplete: false,
    },
  });

  assert.equal(isVideoPromotionExitEvidenceReady(evidence), false);
});

test('consumo insuficiente impede saída de OBSERVE_ONLY', () => {
  const evidence = readyEvidence({
    consumption: {
      observedDays:
        PRODUCT_CALIBRATION_REQUIRED_EVIDENCE
          .minimumObservedDaysPerRuntimeMetric,
      runtimeSamples:
        PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.minimumRuntimeSamplesPerMetric,
      sufficient: false,
      commercialUtilizationObserved: true,
    },
  });

  assert.equal(isVideoPromotionExitEvidenceReady(evidence), false);
});

test('abuso sem sinais observados ou revisão concluída impede saída', () => {
  const evidence = readyEvidence({
    abuse: {
      observedDays:
        PRODUCT_CALIBRATION_REQUIRED_EVIDENCE
          .minimumObservedDaysPerRuntimeMetric,
      runtimeSamples:
        PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.minimumRuntimeSamplesPerMetric,
      sufficient: true,
      abuseSignalsObserved: false,
      reviewComplete: false,
    },
  });

  assert.equal(isVideoPromotionExitEvidenceReady(evidence), false);
});

test('staging, amostra curta ou janela curta não qualificam evidência real', () => {
  const evidence = readyEvidence({
    observationSource: 'staging_runtime',
    realDataQualified: false,
    productionWindowDays:
      PRODUCT_CALIBRATION_REQUIRED_EVIDENCE.minimumProductionWindowDays - 1,
  });

  assert.equal(isVideoPromotionExitEvidenceReady(evidence), false);
});
