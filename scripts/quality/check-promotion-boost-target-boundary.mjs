// scripts/quality/check-promotion-boost-target-boundary.mjs
// -----------------------------------------------------------------------------
// PROMOTION / BOOST TARGET BOUNDARY
// -----------------------------------------------------------------------------
// Contrato genérico reconhece Community, Photo e Video, mas Video permanece
// contract-only: sem criação, placement, billing ou serving enquanto não houver
// habilitação explícita posterior à calibração.
// -----------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function requireIncludes(source, fragment, label) {
  if (!source.includes(fragment)) {
    throw new Error('[promotion-target-boundary] ' + label + ': ' + fragment);
  }
}

function forbidIncludes(source, fragment, label) {
  if (source.includes(fragment)) {
    throw new Error('[promotion-target-boundary] ' + label + ': ' + fragment);
  }
}

const policy = read(
  'functions/src/promotion-boost/promotion-boost.policy.ts'
);

for (const fragment of [
  "PromotionBoostTargetType = 'community' | 'photo' | 'video'",
  'normalizePromotionBoostTargetType',
  'promotionBoostTargetAvailability',
  'VIDEO_PROMOTION_CALIBRATION_STAGE',
  "targetType === 'video'",
  'campaignCreationEnabled: false',
  'placementEnabled: false',
  "'observe_only_not_calibrated'",
  "'explicit_enablement_required'",
  '!promotionBoostTargetAvailability(targetType).campaignCreationEnabled',
  '!promotionBoostTargetAvailability(campaign.targetType).placementEnabled',
]) {
  requireIncludes(policy, fragment, 'generic target contract drift');
}

const photoManager = read(
  'functions/src/promotion-boost/manage-photo-promotion-campaign.handler.ts'
);
requireIncludes(
  photoManager,
  "targetType: 'photo'",
  'photo campaign handler must remain photo-specific'
);
forbidIncludes(
  photoManager,
  "targetType: 'video'",
  'video campaign creation must not be activated through photo handler'
);

const photoSelection = read(
  'functions/src/promotion-boost/photo-promotion-selection.service.ts'
);
requireIncludes(
  photoSelection,
  ".where('targetType', '==', 'photo')",
  'paid placement selection must remain photo-specific'
);
forbidIncludes(
  photoSelection,
  ".where('targetType', '==', 'video')",
  'video paid placement must remain disabled'
);

const promotionIndex = read(
  'functions/src/promotion-boost/index.ts'
);
for (const forbidden of [
  'manageVideoPromotionCampaign',
  'getVideoPromotionPlacement',
  'recordVideoPromotionEvent',
  'selectVideoPromotionPlacement',
]) {
  forbidIncludes(
    promotionIndex,
    forbidden,
    'video promotion runtime surface must remain absent'
  );
}

const videoCalibration = read(
  'functions/src/promotion-boost/video-promotion-calibration.policy.ts'
);
for (const fragment of [
  "VIDEO_PROMOTION_CALIBRATION_STAGE:",
  "= 'OBSERVE_ONLY'",
  'VIDEO_PROMOTION_RUNTIME_ENABLEMENT = false',
  'VIDEO_PROMOTION_OBSERVATION_SOURCE',
  'isVideoPromotionExitEvidenceReady',
  'isVideoPromotionCalibrationChangeReviewable',
  "evidence['cost']",
  "evidence['consumption']",
  "evidence['abuse']",
  "cost['financialActualsComplete'] === true",
  "consumption['commercialUtilizationObserved'] === true",
  "abuse['abuseSignalsObserved'] === true",
  "abuse['reviewComplete'] === true",
]) {
  requireIncludes(
    videoCalibration,
    fragment,
    'video promotion calibration/evidence drift'
  );
}

const videoCalibrationTests = read(
  'functions/src/promotion-boost/video-promotion-calibration.policy.test.ts'
);
for (const fragment of [
  'custo incompleto impede saída',
  'consumo insuficiente impede saída',
  'abuso sem sinais observados ou revisão concluída impede saída',
  'staging, amostra curta ou janela curta não qualificam evidência real',
]) {
  requireIncludes(
    videoCalibrationTests,
    fragment,
    'video promotion evidence coverage drift'
  );
}

console.log(
  '[promotion-target-boundary] OK: Photo may evolve independently; Video remains contract-only, OBSERVE_ONLY and runtime-disabled until production cost/consumption/abuse evidence is sufficient and enablement is explicit.'
);
