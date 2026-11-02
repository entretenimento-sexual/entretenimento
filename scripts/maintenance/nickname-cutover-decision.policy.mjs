// Pure GO/NO-GO preflight. No private IDs, network calls or mutations.
// A clean inventory never substitutes release approval.
const requiredEvidence = Object.freeze([
  'callablesDeployed', 'appCheckVerified',
  'verifiedAdultAndLegalFlowTested', 'clientVersionFloorEnforced',
  'zeroLegacyWritesObserved', 'socialAndEmailRegistrationTested',
  'rollbackTested', 'supportAndPrivacyReviewed',
  'nicknameIndexReadPrivacyReviewed', 'securityApproved',
]);

export function evaluateNicknameCutoverDecision({
  inventory, indexScan, rollout,
} = {}) {
  const reasons = [];
  if (!inventory || inventory.mode !== 'READ_ONLY') {
    reasons.push('MISSING_READ_ONLY_INVENTORY');
  } else {
    if (inventory.truncated !== false) reasons.push('INVENTORY_NOT_EXHAUSTIVE');
    if (!Number.isSafeInteger(inventory.scannedUsers) ||
      inventory.scannedUsers < 1 ||
      !Number.isSafeInteger(inventory.completedUsers) ||
      inventory.completedUsers < 1) {
      reasons.push('INVENTORY_NO_COMPLETED_ACCOUNTS');
    }
    if (!Number.isSafeInteger(inventory.review) || inventory.review !== 0 ||
      (inventory.flags && Object.values(inventory.flags).some(
        value => !Number.isSafeInteger(value) || value !== 0
      ))) {
      reasons.push('INVENTORY_CONFLICTS_OR_UNKNOWN');
    }
  }
  if (!indexScan || indexScan.mode !== 'DRY_RUN') {
    reasons.push('MISSING_INDEX_DRY_RUN');
  } else {
    if (indexScan.truncated !== false) reasons.push('INDEX_SCAN_NOT_EXHAUSTIVE');
    if (!Number.isSafeInteger(indexScan.scanned) ||
      indexScan.scanned < 1) {
      reasons.push('INDEX_SCAN_EMPTY_OR_UNKNOWN');
    }
    for (const key of ['candidate', 'invalid', 'conflict',
      'applied', 'changedDuringTransaction']) {
      if (!Number.isSafeInteger(indexScan[key]) || indexScan[key] !== 0) {
        reasons.push('INDEX_' + key.toUpperCase() + '_REQUIRES_REVIEW');
      }
    }
  }
  if (inventory?.projectId && indexScan?.projectId &&
    inventory.projectId !== indexScan.projectId) {
    reasons.push('MISMATCHED_PROJECTS');
  }
  if (!rollout || rollout.projectId !== inventory?.projectId ||
    rollout.projectId !== indexScan?.projectId) {
    reasons.push('MISSING_OR_MISMATCHED_ROLLOUT_ATTESTATION');
  }
  for (const key of requiredEvidence) {
    if (rollout?.[key] !== true) reasons.push('MISSING_EVIDENCE_' + key);
  }
  if (!Number.isSafeInteger(rollout?.legacyObservationDays) ||
    rollout.legacyObservationDays < 30) {
    reasons.push('INSUFFICIENT_LEGACY_CLIENT_OBSERVATION');
  }
  const version = rollout?.clientVersionFloor;
  if (typeof version !== 'string' || !version.trim()) {
    reasons.push('CLIENT_VERSION_FLOOR_UNSPECIFIED');
  }
  // Even when complete, this is only a review candidate. Not an
  // authorization to deploy, alter rules, or migrate records.
  return Object.freeze({
    status: reasons.length ? 'NO_GO' : 'REVIEW_READY',
    deploymentAuthorized: false,
    reasons,
  });
}
