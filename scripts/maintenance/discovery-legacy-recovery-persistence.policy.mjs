// Issue #236 — B2.2: PREPARATION ONLY for sensitive legacy preference
// preservation. This module is pure: no Admin SDK, credentials, network, files,
// logging, scheduler, UI, Firestore mutations, or callable exports.
//
// A true server writer MUST implement separate, independently verified auth,
// lifecycle/retention and audit controls. No object supplied by a caller is
// sufficient to authorize real persistence.
import {
  verifyRecoveryCandidates,
} from './discovery-legacy-recovery-transaction.policy.mjs';
import {
  assertExpectedIncident,
} from './discovery-legacy-recovery-rollback-runner.policy.mjs';
import {
  TARGET_COLLECTION, PROJECT_ID,
} from './discovery-legacy-recovery-rehearsal.policy.mjs';

export const RECOVERY_PERSISTENCE_POLICY_VERSION = 1;
export const PROPOSED_RETENTION_DAYS = 30; // proposal, NOT an approved retention rule
export const MS_PER_DAY = 24 * 60 * 60 * 1000;

// These are implementation blockers, not user-configurable toggles.
// They cannot be satisfied by passing "true" from a caller.
export const MANDATORY_RELEASE_BLOCKERS = Object.freeze([
  'SERVER_VERIFIED_ADMIN_AUTH_NOT_IMPLEMENTED',
  'EXPLICIT_OPERATION_APPROVAL_NOT_IMPLEMENTED',
  'ACCOUNT_DELETION_PURGE_NOT_INTEGRATED',
  'RETENTION_EXPIRY_JOB_NOT_INTEGRATED',
  'BACKEND_ONLY_AUDIT_WRITER_NOT_IMPLEMENTED',
  'PERSISTENT_WRITE_AND_ROLLBACK_NOT_APPROVED',
]);

const SAFE_AUDIT_ACTIONS = Object.freeze([
  'B2_2_PLAN_PREPARED',
  'B2_2_PLAN_BLOCKED',
  'B2_2_PLAN_REJECTED',
]);

function assertPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error('INVALID_POLICY_INPUT');
  }
}

function safeInteger(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function assertVerifiedB21Proof(proof) {
  assertPlainObject(proof);
  if (proof.mode !== 'ISOLATED_IMPORT_COPY_VERIFY_ROLLBACK' ||
      proof.project !== PROJECT_ID ||
      proof.host !== '127.0.0.1:28080' ||
      !safeInteger(proof.scannedPublicProfiles, 2, 200) ||
      proof.candidates !== 2 ||
      proof.interestedInGendersItems !== 5 ||
      proof.interestedInOrientationsItems !== 3 ||
      proof.initiallyCreated !== 2 ||
      proof.idempotentSecondRunCreated !== 0 ||
      proof.rolledBack !== 2 ||
      !safeInteger(proof.snapshotDocumentsVerified, 2, 2500) ||
      proof.contentDifferences !== 0 ||
      proof.mainEmulatorModified !== false ||
      proof.originalExportModified !== false ||
      proof.productionModified !== false ||
      proof.metadataTimestampFidelityProven !== false ||
      proof.ownerConsentRequired !== true) {
    throw new Error('B21_PROOF_NOT_SATISFIED');
  }
  // This is a structurally checked local report, not an authenticated
  // attestation. Never authorize production on the strength of this report.
}

function verifyCandidateCounts(candidates) {
  const countGenders = candidates.reduce(
    (sum, candidate) => sum + (candidate.legacyRaw.interestedInGenders?.length ?? 0),
    0
  );
  const countOrientations = candidates.reduce(
    (sum, candidate) => sum +
      (candidate.legacyRaw.interestedInOrientations?.length ?? 0),
    0
  );
  assertExpectedIncident(candidates.length, countGenders, countOrientations);
}

export function prepareSensitiveRecoveryRetentionPlan(input) {
  assertPlainObject(input);
  const { candidates, isolatedRehearsalReport, nowMs } = input;
  verifyRecoveryCandidates(candidates);
  verifyCandidateCounts(candidates);
  assertVerifiedB21Proof(isolatedRehearsalReport);

  // Time is explicitly supplied for reproducible tests; never infer from the
  // imported createTime/updateTime, which change on emulator import.
  if (!safeInteger(nowMs, 1_700_000_000_000, 4_000_000_000_000)) {
    throw new Error('INVALID_REVIEW_TIMESTAMP');
  }

  const proposedReviewDeadline = nowMs + PROPOSED_RETENTION_DAYS * MS_PER_DAY;
  if (!Number.isSafeInteger(proposedReviewDeadline)) {
    throw new Error('INVALID_REVIEW_DEADLINE');
  }

  // Private plan is IN MEMORY ONLY. IDs/hashes stay out of reports and logs.
  // No raw array values are duplicated in this plan.
  const privateIntents = candidates.map((candidate) => ({
    ownerUid: candidate.ownerUid,
    sourcePath: `public_profiles/${candidate.ownerUid}`,
    recoveryPath: `${TARGET_COLLECTION}/${candidate.ownerUid}`,
    expectedSourceContentSha256: candidate.contentSha256,
    recoveryStatus: 'PENDING_REVIEW',
    proposedReviewDeadline,
    visibilityConsentConfirmed: false,
    ownerDeletionMustPurge: true,
  }));

  const report = Object.freeze({
    policyVersion: RECOVERY_PERSISTENCE_POLICY_VERSION,
    phase: 'B2_2_PREPARATION_ONLY',
    decision: 'BLOCKED',
    candidateCount: candidates.length,
    legacyEntryCount: 8,
    proposedRetentionDays: PROPOSED_RETENTION_DAYS,
    ownerConsentRequired: true,
    semanticReviewRequired: true,
    accountDeletionPurgeReady: false,
    persistentWritesAllowed: false,
    sourceFieldsDeletionAllowed: false,
    visibilityActivationAllowed: false,
    documentedBlockers: [...MANDATORY_RELEASE_BLOCKERS],
  });

  return { privateIntents, report };
}

export function makeRecoveryAuditSummary({ action, report }) {
  if (!SAFE_AUDIT_ACTIONS.includes(action)) {
    throw new Error('UNAUTHORIZED_AUDIT_ACTION');
  }
  assertPlainObject(report);
  if (report.policyVersion !== RECOVERY_PERSISTENCE_POLICY_VERSION ||
      report.phase !== 'B2_2_PREPARATION_ONLY' ||
      report.decision !== 'BLOCKED' ||
      report.candidateCount !== 2 ||
      report.legacyEntryCount !== 8 ||
      report.persistentWritesAllowed !== false ||
      report.sourceFieldsDeletionAllowed !== false ||
      report.visibilityActivationAllowed !== false) {
    throw new Error('UNTRUSTED_AUDIT_REPORT');
  }

  // Strict allowlist. NEVER accept actor IDs, owner IDs, field values,
  // hashes, free-text notes or original report as audit properties.
  return Object.freeze({
    policyVersion: RECOVERY_PERSISTENCE_POLICY_VERSION,
    action,
    outcome: 'BLOCKED',
    candidateCount: report.candidateCount,
    legacyEntryCount: report.legacyEntryCount,
    writesPerformed: 0,
    requiresIndependentAdministrativeAuthorization: true,
  });
}

export function assertPersistentRecoveryMayExecute() {
  // B2.2 deliberately provides NO persistence entrypoint.
  // This cannot be opened through an env flag, mocked admin role, CLI arg,
  // or a caller-provided approval object. A separate reviewed backend
  // implementation is required before any persistent write.
  throw new Error('PERSISTENT_RECOVERY_NOT_AUTHORIZED');
}
