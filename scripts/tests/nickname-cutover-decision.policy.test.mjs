import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateNicknameCutoverDecision } from '../maintenance/nickname-cutover-decision.policy.mjs';

const ready = {
  inventory: {
    projectId: 'demo-project', mode: 'READ_ONLY', truncated: false,
    scannedUsers: 250, completedUsers: 230, review: 0, flags: {},
  },
  indexScan: {
    projectId: 'demo-project', mode: 'DRY_RUN', truncated: false,
    scanned: 230, candidate: 0, invalid: 0, conflict: 0,
    applied: 0, changedDuringTransaction: 0,
  },
  rollout: {
    projectId: 'demo-project', callablesDeployed: true,
    appCheckVerified: true, verifiedAdultAndLegalFlowTested: true,
    clientVersionFloorEnforced: true,
    zeroLegacyWritesObserved: true, socialAndEmailRegistrationTested: true,
    rollbackTested: true, supportAndPrivacyReviewed: true,
    nicknameIndexReadPrivacyReviewed: true, securityApproved: true,
    legacyObservationDays: 30, clientVersionFloor: '2026.11.1',
  },
};

test('absence of real evidence defaults to NO_GO', () => {
  const result = evaluateNicknameCutoverDecision();
  assert.equal(result.status, 'NO_GO');
  assert.equal(result.deploymentAuthorized, false);
  assert.ok(result.reasons.includes('MISSING_READ_ONLY_INVENTORY'));
});
test('even a complete candidate is not deployment authorization', () => {
  assert.deepEqual(evaluateNicknameCutoverDecision(ready), {
    status: 'REVIEW_READY', deploymentAuthorized: false, reasons: [],
  });
});
test('unmigrated nickname reservations block cutover', () => {
  const actual = evaluateNicknameCutoverDecision({
    ...ready, indexScan: { ...ready.indexScan, candidate: 12 },
  });
  assert.equal(actual.status, 'NO_GO');
  assert.ok(actual.reasons.includes('INDEX_CANDIDATE_REQUIRES_REVIEW'));
});
test('legacy clients still writing block cutover', () => {
  const r = evaluateNicknameCutoverDecision({
    ...ready, rollout: { ...ready.rollout,
      zeroLegacyWritesObserved: false, legacyObservationDays: 7 },
  });
  assert.equal(r.status, 'NO_GO');
  assert.ok(r.reasons.includes('MISSING_EVIDENCE_zeroLegacyWritesObserved'));
  assert.ok(r.reasons.includes('INSUFFICIENT_LEGACY_CLIENT_OBSERVATION'));
});
test('partial scan and mismatched projects are blocking', () => {
  const r = evaluateNicknameCutoverDecision({
    ...ready,
    inventory: { ...ready.inventory, truncated: true, projectId: 'other' },
  });
  assert.equal(r.status, 'NO_GO');
  assert.ok(r.reasons.includes('INVENTORY_NOT_EXHAUSTIVE'));
  assert.ok(r.reasons.includes('MISMATCHED_PROJECTS'));
});
test('privacy and safety sign-offs remain explicit', () => {
  const r = evaluateNicknameCutoverDecision({
    ...ready, rollout: { ...ready.rollout,
      nicknameIndexReadPrivacyReviewed: false, securityApproved: false },
  });
  assert.equal(r.status, 'NO_GO');
  assert.ok(r.reasons.includes('MISSING_EVIDENCE_nicknameIndexReadPrivacyReviewed'));
  assert.ok(r.reasons.includes('MISSING_EVIDENCE_securityApproved'));
});
