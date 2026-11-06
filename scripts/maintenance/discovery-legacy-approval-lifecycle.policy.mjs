// Issue #236 — B2.9.1: pure state-machine proposal, NO authority.
// Only in-memory synthetic records. No Firebase, IO, logs, deployments or writes.
// In-memory revision checks do not establish Firestore transaction atomicity.
import {
  LEGACY_RECOVERY_OPERATION_PURPOSE,
  LEGACY_RECOVERY_APPROVAL_WINDOW_MS,
} from './discovery-legacy-recovery-governance.policy.mjs';

export const LEGACY_APPROVAL_LIFECYCLE_VERSION = 1;
export const LEGACY_APPROVAL_STATE = Object.freeze({
  REQUESTED: 'REQUESTED_FOR_REVIEW',
  APPROVED: 'APPROVED_FOR_REVIEW_ONLY',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED',
  CONSUMED: 'CONSUMED_FOR_REVIEW_ONLY',
});
export const LEGACY_APPROVAL_EVENT = Object.freeze({
  APPROVE: 'APPROVE_FOR_REVIEW',
  REVOKE: 'REVOKE_REVIEW',
  EXPIRE: 'EXPIRE_REVIEW',
  CONSUME: 'CONSUME_REVIEW',
});
const PROJECT = 'entretenimento-sexual';
const COLLECTION = 'legacy_discovery_preference_recovery';
const ID = /^[A-Za-z0-9_-]{12,128}$/;
const TIME_MIN = 1_700_000_000_000;
const TIME_MAX = 4_000_000_000_000;
const OWN_KEYS = [
  'schemaVersion', 'operationId', 'purpose', 'projectId',
  'targetCollection', 'candidateCount', 'legacyEntryCount',
  'requestedByUid', 'requestedAtMs', 'approvedByUid',
  'approvedAtMs', 'expiresAtMs', 'revokedAtMs',
  'consumedAtMs', 'expiredAtMs', 'status', 'revision',
];
const EVENT_KEYS = ['record', 'event', 'actorUid', 'expectedRevision', 'nowMs'];
const REQUEST_KEYS = ['operationId', 'requestedByUid', 'nowMs'];

function objectOnly(value, keys) {
  return !!value && typeof value === 'object' &&
    !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).length === keys.length &&
    keys.every(key => Object.hasOwn(value, key));
}
function identifier(value) {
  return typeof value === 'string' && ID.test(value);
}
function timestamp(value) {
  return Number.isSafeInteger(value) && value >= TIME_MIN && value <= TIME_MAX;
}
function revision(value) {
  return Number.isSafeInteger(value) && value >= 0 && value < 1_000_000;
}
function requireRecord(record) {
  if (!objectOnly(record, OWN_KEYS) ||
      record.schemaVersion !== LEGACY_APPROVAL_LIFECYCLE_VERSION ||
      !identifier(record.operationId) || !identifier(record.requestedByUid) ||
      record.purpose !== LEGACY_RECOVERY_OPERATION_PURPOSE ||
      record.projectId !== PROJECT || record.targetCollection !== COLLECTION ||
      record.candidateCount !== 2 || record.legacyEntryCount !== 8 ||
      !timestamp(record.requestedAtMs) || !revision(record.revision) ||
      !Object.values(LEGACY_APPROVAL_STATE).includes(record.status)) {
    throw new Error('LEGACY_APPROVAL_INVALID_RECORD');
  }
  const { REQUESTED, APPROVED, REVOKED, EXPIRED, CONSUMED } = LEGACY_APPROVAL_STATE;
  const neverApproved = record.approvedByUid === null &&
    record.approvedAtMs === null && record.expiresAtMs === null;
  const approved = identifier(record.approvedByUid) &&
    record.approvedByUid !== record.requestedByUid &&
    timestamp(record.approvedAtMs) &&
    timestamp(record.expiresAtMs) &&
    record.approvedAtMs >= record.requestedAtMs &&
    record.expiresAtMs - record.approvedAtMs ===
      LEGACY_RECOVERY_APPROVAL_WINDOW_MS;
  const revoked = record.revokedAtMs;
  const consumed = record.consumedAtMs;
  const expired = record.expiredAtMs;
  const valid =
    (record.status === REQUESTED && record.revision === 0 &&
      neverApproved && revoked === null && consumed === null &&
      expired === null) ||
    (record.status === APPROVED && record.revision === 1 &&
      approved && revoked === null && consumed === null &&
      expired === null) ||
    (record.status === REVOKED &&
      ((neverApproved && record.revision === 1) ||
        (approved && record.revision === 2)) &&
      timestamp(revoked) && revoked >= record.requestedAtMs &&
      (neverApproved ?
        revoked < record.requestedAtMs + LEGACY_RECOVERY_APPROVAL_WINDOW_MS :
        revoked >= record.approvedAtMs && revoked < record.expiresAtMs) &&
      consumed === null && expired === null) ||
    (record.status === EXPIRED &&
      ((neverApproved && record.revision === 1) ||
        (approved && record.revision === 2)) &&
      revoked === null && consumed === null && timestamp(expired) &&
      (neverApproved ?
        expired >= record.requestedAtMs + LEGACY_RECOVERY_APPROVAL_WINDOW_MS :
        expired >= record.expiresAtMs)) ||
    (record.status === CONSUMED && record.revision === 2 &&
      approved && revoked === null && timestamp(consumed) &&
      consumed >= record.approvedAtMs && consumed < record.expiresAtMs &&
      expired === null);
  if (!valid) throw new Error('LEGACY_APPROVAL_INVALID_RECORD');
  return record;
}

export function createLegacyReviewRequest(input) {
  if (!objectOnly(input, REQUEST_KEYS) ||
      !identifier(input.operationId) || !identifier(input.requestedByUid) ||
      !timestamp(input.nowMs)) {
    throw new Error('LEGACY_APPROVAL_INVALID_REQUEST');
  }
  return Object.freeze({
    schemaVersion: LEGACY_APPROVAL_LIFECYCLE_VERSION,
    operationId: input.operationId,
    purpose: LEGACY_RECOVERY_OPERATION_PURPOSE,
    projectId: PROJECT,
    targetCollection: COLLECTION,
    candidateCount: 2,
    legacyEntryCount: 8,
    requestedByUid: input.requestedByUid,
    requestedAtMs: input.nowMs,
    approvedByUid: null,
    approvedAtMs: null,
    expiresAtMs: null,
    revokedAtMs: null,
    consumedAtMs: null,
    expiredAtMs: null,
    status: LEGACY_APPROVAL_STATE.REQUESTED,
    revision: 0,
  });
}

/** A proposed state change only. Caller-supplied actor is NEVER verified auth. */
export function proposeLegacyReviewTransition(input) {
  if (!objectOnly(input, EVENT_KEYS) ||
      !timestamp(input.nowMs) || !revision(input.expectedRevision) ||
      !Object.values(LEGACY_APPROVAL_EVENT).includes(input.event) ||
      !(input.actorUid === null || identifier(input.actorUid))) {
    throw new Error('LEGACY_APPROVAL_INVALID_TRANSITION');
  }
  const record = requireRecord(input.record);
  if (record.revision !== input.expectedRevision) {
    throw new Error('LEGACY_APPROVAL_STALE_REVISION');
  }
  if (input.nowMs < record.requestedAtMs) {
    throw new Error('LEGACY_APPROVAL_INVALID_TIME');
  }
  const { REQUESTED, APPROVED } = LEGACY_APPROVAL_STATE;
  const { APPROVE, REVOKE, EXPIRE, CONSUME } = LEGACY_APPROVAL_EVENT;
  const { event, actorUid, nowMs } = input;
  let patch;
  if (event === APPROVE && record.status === REQUESTED &&
      identifier(actorUid) && actorUid !== record.requestedByUid &&
      nowMs < record.requestedAtMs + LEGACY_RECOVERY_APPROVAL_WINDOW_MS &&
      nowMs + LEGACY_RECOVERY_APPROVAL_WINDOW_MS <= TIME_MAX) {
    patch = {
      status: LEGACY_APPROVAL_STATE.APPROVED,
      approvedByUid: actorUid,
      approvedAtMs: nowMs,
      expiresAtMs: nowMs + LEGACY_RECOVERY_APPROVAL_WINDOW_MS,
    };
  } else if (event === REVOKE &&
      (record.status === REQUESTED || record.status === APPROVED) &&
      (actorUid === record.requestedByUid ||
        (record.status === APPROVED && actorUid === record.approvedByUid)) &&
      ((record.status === REQUESTED &&
        nowMs < record.requestedAtMs + LEGACY_RECOVERY_APPROVAL_WINDOW_MS) ||
       (record.status === APPROVED &&
        nowMs >= record.approvedAtMs && nowMs < record.expiresAtMs))) {
    patch = { status: LEGACY_APPROVAL_STATE.REVOKED, revokedAtMs: nowMs };
  } else if (event === EXPIRE && actorUid === null &&
      ((record.status === REQUESTED &&
        nowMs >= record.requestedAtMs + LEGACY_RECOVERY_APPROVAL_WINDOW_MS) ||
       (record.status === APPROVED && nowMs >= record.expiresAtMs))) {
    patch = { status: LEGACY_APPROVAL_STATE.EXPIRED, expiredAtMs: nowMs };
  } else if (event === CONSUME && record.status === APPROVED &&
      actorUid === record.requestedByUid &&
      nowMs >= record.approvedAtMs && nowMs < record.expiresAtMs) {
    patch = {
      status: LEGACY_APPROVAL_STATE.CONSUMED, consumedAtMs: nowMs,
    };
  } else {
    throw new Error('LEGACY_APPROVAL_TRANSITION_DENIED');
  }
  const proposedRecord = Object.freeze({
    ...record, ...patch, revision: record.revision + 1,
  });
  requireRecord(proposedRecord);
  return Object.freeze({
    proposedRecord,
    report: Object.freeze({
      phase: 'B2_9_1_PURE_LIFECYCLE',
      event,
      outcome: 'BLOCKED',
      proposalOnly: true,
      backendAuthorityVerified: false,
      transactionCommitted: false,
      approvalPersisted: false,
      auditPersisted: false,
      persistentRecoveryAllowed: false,
      sourceDeletionAllowed: false,
      publicVisibilityAllowed: false,
    }),
  });
}

export function assertLegacyReviewMayPersist() {
  throw new Error('LEGACY_APPROVAL_PERSISTENCE_NOT_AUTHORIZED');
}
