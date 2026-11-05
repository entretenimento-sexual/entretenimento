// Issue #236 — B2.6. Pure, non-authorizing governance preflight.
// No Firebase imports, service credentials, persistence, logging or endpoints.
// All arguments are UNTRUSTED evidence structures. A future backend must fetch
// them independently and recheck operator, reviewer, approval and owner in an
// authenticated server-side transaction before it may ever stage a write.
// A passing preflight NEVER grants mutation rights.
import {
  PROJECT_ID, TARGET_COLLECTION,
} from './discovery-legacy-recovery-rehearsal.policy.mjs';

export const LEGACY_RECOVERY_GOVERNANCE_VERSION = 1;
export const LEGACY_RECOVERY_OPERATION_PURPOSE =
  'PRIVATE_LEGACY_DISCOVERY_PRESERVATION_REVIEW';
export const LEGACY_RECOVERY_APPROVAL_WINDOW_MS = 15 * 60_000;
const ID = /^[A-Za-z0-9_-]{12,128}$/;
const OPERATIONS = Object.freeze([
  'B2_6_PRECHECK_EVALUATED',
  'B2_6_PRECHECK_BLOCKED',
  'B2_6_PRECHECK_REJECTED',
]);
const EVIDENCE_KEYS = Object.freeze([
  'request', 'operatorIdentity', 'operatorAccount',
  'reviewerAccount', 'approvalRecord', 'nowMs',
]);

function isPlain(value) {
  return value !== null && typeof value === 'object' &&
    !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function onlyKeys(value, keys) {
  return isPlain(value) &&
    Object.keys(value).every((key) => keys.includes(key));
}
function uid(value) {
  return typeof value === 'string' && ID.test(value);
}
function time(value) {
  return Number.isSafeInteger(value) &&
    value >= 1_700_000_000_000 && value <= 4_000_000_000_000;
}
function activeAdmin(doc) {
  return onlyKeys(doc, [
    'uid', 'role', 'accountStatus', 'adminPrivilegeRevokedAt',
    'deletionRequestedAt', 'purgeLeaseOwner', 'purgeLeaseUntil',
    'legalHold', 'billingHold', 'disabled',
    'privateRecoveryReviewer',
    'privateRecoveryOperator',
  ]) &&
    uid(doc.uid) && doc.role === 'admin' &&
    doc.accountStatus === 'active' &&
    doc.adminPrivilegeRevokedAt == null &&
    doc.deletionRequestedAt == null &&
    doc.purgeLeaseOwner == null &&
    doc.purgeLeaseUntil == null &&
    doc.legalHold !== true &&
    doc.billingHold !== true && doc.disabled !== true;
}

function validatedRequest(request) {
  return onlyKeys(request, [
    'operationId', 'operatorUid', 'purpose',
    'projectId', 'targetCollection', 'candidateCount',
    'legacyEntryCount',
  ]) &&
    uid(request.operationId) && uid(request.operatorUid) &&
    request.purpose === LEGACY_RECOVERY_OPERATION_PURPOSE &&
    request.projectId === PROJECT_ID &&
    request.targetCollection === TARGET_COLLECTION &&
    request.candidateCount === 2 && request.legacyEntryCount === 8;
}

function validatedIdentity(identity, request, nowMs) {
  return onlyKeys(identity, [
    'uid', 'disabled', 'emailVerified', 'tokenRevoked',
    'authenticatedAtMs', 'checkedAtMs',
  ]) &&
    identity.uid === request?.operatorUid &&
    identity.disabled === false &&
    identity.emailVerified === true &&
    identity.tokenRevoked === false &&
    time(identity.authenticatedAtMs) &&
    time(identity.checkedAtMs) &&
    identity.authenticatedAtMs <= nowMs &&
    identity.checkedAtMs <= nowMs &&
    nowMs - identity.authenticatedAtMs <= LEGACY_RECOVERY_APPROVAL_WINDOW_MS &&
    nowMs - identity.checkedAtMs <= 60_000;
}

function validatedApproval(approval, request, operator, reviewer, nowMs) {
  return onlyKeys(approval, [
    'operationId', 'purpose', 'status',
    'projectId', 'targetCollection', 'candidateCount', 'legacyEntryCount',
    'requestedByUid', 'approvedByUid',
    'approvedAtMs', 'expiresAtMs', 'revokedAtMs', 'consumedAtMs',
  ]) &&
    approval.operationId === request?.operationId &&
    approval.purpose === LEGACY_RECOVERY_OPERATION_PURPOSE &&
    approval.status === 'APPROVED_FOR_REVIEW_ONLY' &&
    approval.projectId === PROJECT_ID &&
    approval.targetCollection === TARGET_COLLECTION &&
    approval.candidateCount === 2 &&
    approval.legacyEntryCount === 8 &&
    approval.requestedByUid === operator?.uid &&
    uid(approval.approvedByUid) &&
    approval.approvedByUid !== operator?.uid &&
    approval.approvedByUid === reviewer?.uid &&
    time(approval.approvedAtMs) &&
    time(approval.expiresAtMs) &&
    approval.approvedAtMs <= nowMs &&
    approval.expiresAtMs > nowMs &&
    approval.expiresAtMs - approval.approvedAtMs <=
      LEGACY_RECOVERY_APPROVAL_WINDOW_MS &&
    approval.revokedAtMs == null && approval.consumedAtMs == null;
}

/**
 * Shape-only readiness assessment; no database authenticity proof.
 * The explicit APPROVED_FOR_REVIEW_ONLY status can never be interpreted as
 * authorization to migrate, write, delete legacy fields or reveal interests.
 */
export function evaluateLegacyRecoveryGovernanceEvidence(input) {
  if (!onlyKeys(input, EVIDENCE_KEYS)) {
    throw new Error('RECOVERY_GOVERNANCE_INVALID_INPUT');
  }
  const { request, operatorIdentity, operatorAccount,
    reviewerAccount, approvalRecord, nowMs } = input;
  if (!time(nowMs)) {
    throw new Error('RECOVERY_GOVERNANCE_INVALID_TIME');
  }

  const requestMatches = validatedRequest(request);
  const identityMatches = validatedIdentity(operatorIdentity, request, nowMs);
  const operatorEligible = activeAdmin(operatorAccount) &&
    operatorAccount.uid === request?.operatorUid &&
    operatorAccount.privateRecoveryOperator === true;
  const reviewerEligible = activeAdmin(reviewerAccount) &&
    reviewerAccount.privateRecoveryReviewer === true &&
    reviewerAccount.uid !== request?.operatorUid;
  const approvalMatches = validatedApproval(
    approvalRecord, request, operatorAccount, reviewerAccount, nowMs
  );

  // All checks are informational and can be fabricated by a caller. A future
  // backend MUST use independently verified auth and fresh Firestore reads.
  return Object.freeze({
    version: LEGACY_RECOVERY_GOVERNANCE_VERSION,
    phase: 'B2_6_EVIDENCE_ONLY',
    outcome: 'BLOCKED',
    requestMatches,
    identityMatches,
    operatorEligible,
    reviewerEligible,
    approvalMatches,
    evidenceShapeCompatible: !!(
      requestMatches && identityMatches && operatorEligible &&
      reviewerEligible && approvalMatches
    ),
    backendAuthorityVerified: false,
    approvalConsumed: false,
    auditPersisted: false,
    expirationJobImplemented: false,
    ownerConsentEstablished: false,
    persistentWritesAllowed: false,
    sourceDeletionAllowed: false,
    publicVisibilityAllowed: false,
    requiresServerSideRevalidation: true,
  });
}

export function buildLegacyRecoveryAuditEnvelope({ action, assessment }) {
  if (!OPERATIONS.includes(action) ||
      !onlyKeys(assessment, [
        'version', 'phase', 'outcome', 'requestMatches',
        'identityMatches', 'operatorEligible', 'reviewerEligible',
        'approvalMatches', 'evidenceShapeCompatible',
        'backendAuthorityVerified', 'approvalConsumed', 'auditPersisted',
        'expirationJobImplemented', 'ownerConsentEstablished',
        'persistentWritesAllowed', 'sourceDeletionAllowed',
        'publicVisibilityAllowed', 'requiresServerSideRevalidation',
      ]) ||
      assessment.version !== LEGACY_RECOVERY_GOVERNANCE_VERSION ||
      assessment.phase !== 'B2_6_EVIDENCE_ONLY' ||
      assessment.outcome !== 'BLOCKED' ||
      assessment.backendAuthorityVerified !== false ||
      assessment.approvalConsumed !== false ||
      assessment.auditPersisted !== false ||
      assessment.expirationJobImplemented !== false ||
      assessment.ownerConsentEstablished !== false ||
      assessment.persistentWritesAllowed !== false ||
      assessment.sourceDeletionAllowed !== false ||
      assessment.publicVisibilityAllowed !== false ||
      assessment.requiresServerSideRevalidation !== true) {
    throw new Error('RECOVERY_GOVERNANCE_UNTRUSTED_AUDIT');
  }

  // Strict aggregate-only envelope. No UID, approval ID, operation ID,
  // hash, legacy value, reason text, path, actor or arbitrary metadata.
  return Object.freeze({
    version: LEGACY_RECOVERY_GOVERNANCE_VERSION,
    event: action,
    scope: 'PRIVATE_LEGACY_RECOVERY_PREFLIGHT_ONLY',
    outcome: 'BLOCKED',
    eligibleEvidenceCount: [
      assessment.requestMatches, assessment.identityMatches,
      assessment.operatorEligible, assessment.reviewerEligible,
      assessment.approvalMatches,
    ].filter((item) => item === true).length,
    checkedEvidenceCount: 5,
    writesPerformed: 0,
    approvalConsumed: false,
    persisted: false,
  });
}

export function assertLegacyRecoveryGovernanceMayPersist() {
  // No parameter, env flag, approval object or synthesized report can unlock.
  throw new Error('LEGACY_RECOVERY_PERSISTENCE_NOT_AUTHORIZED');
}
