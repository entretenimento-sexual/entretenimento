// Issue #236 / B2.9.3d - PURE reconciliation of disposable synthetic projections.
// No SDK, Firestore queries, persistence, secrets, real IDs, repair, deletion or authorization.
// All identifiers are opaque synthetic fixture keys and are NEVER included in reports.
import {
  verifySyntheticReviewAuditChain,
  REVIEW_AUDIT_KINDS,
  REVIEW_AUDIT_PROPOSED_RETENTION_DAYS,
} from './discovery-legacy-approval-audit-integrity.policy.mjs';

export const REVIEW_RECONCILIATION_VERSION = 1;
export const REVIEW_RECONCILIATION_PHASE = 'B2_9_3D_SYNTHETIC_RECONCILIATION';
const MAX_ITEMS = 64;
const MIN_TIME = 1_700_000_000_000;
const MAX_TIME = 4_000_000_000_000;
const WINDOW_MS = 15 * 60_000;
const KEY_RE = /^synthetic-b293d-[a-z0-9-]{3,64}$/;
const ROOT_KEYS = Object.freeze(['approvals', 'audits', 'nowMs']);
const APPROVAL_KEYS = Object.freeze([
  'syntheticKey', 'schemaVersion', 'status', 'revision',
  'purpose', 'projectId', 'targetCollection', 'candidateCount',
  'legacyEntryCount', 'requestedAtMs', 'approvedAtMs', 'expiresAtMs',
  'consumedAtMs', 'revokedAtMs', 'expiredAtMs',
]);
const AUDIT_KEYS = Object.freeze(['syntheticKey', 'schemaVersion', 'entries']);
const STATUSES = new Set([
  'REQUESTED_FOR_REVIEW', 'APPROVED_FOR_REVIEW_ONLY',
  'CONSUMED_FOR_REVIEW_ONLY', 'REVOKED', 'EXPIRED',
]);
const COUNTER_KEYS = Object.freeze([
  'duplicateApprovalKeys', 'duplicateAuditKeys',
  'missingAudit', 'orphanAudit', 'auditWithoutConsumption',
  'invalidScope', 'invalidRevision', 'invalidTimeline',
  'invalidAudit', 'timestampMismatch',
]);

function plain(value) {
  return value !== null && typeof value === 'object' &&
    !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function exact(value, keys) {
  return plain(value) && Object.keys(value).length === keys.length &&
    keys.every(key => Object.hasOwn(value, key));
}
function validTime(v) {
  return Number.isSafeInteger(v) && v >= MIN_TIME && v <= MAX_TIME;
}
function maybeTime(v) {
  return v === null || validTime(v);
}
function syntheticKey(v) {
  return typeof v === 'string' && KEY_RE.test(v);
}
function approvedTimeline(v) {
  return validTime(v.requestedAtMs) && validTime(v.approvedAtMs) &&
    validTime(v.expiresAtMs) && v.requestedAtMs <= v.approvedAtMs &&
    v.approvedAtMs < v.requestedAtMs + WINDOW_MS &&
    v.expiresAtMs - v.approvedAtMs === WINDOW_MS;
}
function scopeOK(v) {
  return v.schemaVersion === 1 &&
    v.purpose === 'PRIVATE_LEGACY_DISCOVERY_PRESERVATION_REVIEW' &&
    v.projectId === 'entretenimento-sexual' &&
    v.targetCollection === 'legacy_discovery_preference_recovery' &&
    v.candidateCount === 2 && v.legacyEntryCount === 8;
}
function revisionOK(v) {
  if (!STATUSES.has(v.status)) return false;
  if (v.status === 'REQUESTED_FOR_REVIEW') return v.revision === 0;
  if (v.status === 'APPROVED_FOR_REVIEW_ONLY') return v.revision === 1;
  if (v.status === 'CONSUMED_FOR_REVIEW_ONLY') return v.revision === 2;
  return v.revision === 1 || v.revision === 2;
}
function timelineOK(v) {
  if (!validTime(v.requestedAtMs) || !maybeTime(v.approvedAtMs) ||
      !maybeTime(v.expiresAtMs) || !maybeTime(v.consumedAtMs) ||
      !maybeTime(v.revokedAtMs) || !maybeTime(v.expiredAtMs)) return false;
  if (v.status === 'REQUESTED_FOR_REVIEW') {
    return v.approvedAtMs === null && v.expiresAtMs === null &&
      v.consumedAtMs === null && v.revokedAtMs === null &&
      v.expiredAtMs === null;
  }
  if (v.status === 'APPROVED_FOR_REVIEW_ONLY') {
    return approvedTimeline(v) && v.consumedAtMs === null &&
      v.revokedAtMs === null && v.expiredAtMs === null;
  }
  if (v.status === 'CONSUMED_FOR_REVIEW_ONLY') {
    return approvedTimeline(v) && validTime(v.consumedAtMs) &&
      v.approvedAtMs <= v.consumedAtMs &&
      v.consumedAtMs < v.expiresAtMs &&
      v.revokedAtMs === null && v.expiredAtMs === null;
  }
  if (v.status === 'REVOKED') {
    return v.consumedAtMs === null && v.expiredAtMs === null &&
      validTime(v.revokedAtMs) && v.revokedAtMs >= v.requestedAtMs &&
      (v.revision === 1
        ? v.approvedAtMs === null && v.expiresAtMs === null
        : approvedTimeline(v) && v.revokedAtMs < v.expiresAtMs);
  }
  if (v.status === 'EXPIRED') {
    return v.consumedAtMs === null && v.revokedAtMs === null &&
      validTime(v.expiredAtMs) &&
      (v.revision === 1
        ? v.approvedAtMs === null && v.expiresAtMs === null &&
          v.expiredAtMs >= v.requestedAtMs + WINDOW_MS
        : approvedTimeline(v) && v.expiredAtMs >= v.expiresAtMs);
  }
  return false;
}
function indexByKey(items) {
  const map = new Map();
  const duplicate = new Set();
  for (const item of items) {
    if (map.has(item.syntheticKey)) duplicate.add(item.syntheticKey);
    else map.set(item.syntheticKey, item);
  }
  return { map, duplicate };
}
function validAudit(value) {
  return value.schemaVersion === 1 &&
    value.entries.length === 1 &&
    verifySyntheticReviewAuditChain(value.entries) &&
    value.entries[0].kind === REVIEW_AUDIT_KINDS.CONSUMED_SYNTHETIC;
}

/**
 * Reconcile projections passed ONLY by synthetic test fixtures.
 * Input is NOT evidence that a Firestore query or real identity check happened.
 * No keys, identifiers, paths, hashes, timestamps or freeform text in output.
 */
export function reconcileSyntheticReviewApprovals(input) {
  if (!exact(input, ROOT_KEYS) || !Array.isArray(input.approvals) ||
      !Array.isArray(input.audits) || !validTime(input.nowMs) ||
      input.approvals.length > MAX_ITEMS || input.audits.length > MAX_ITEMS ||
      !input.approvals.every(v => exact(v, APPROVAL_KEYS) && syntheticKey(v.syntheticKey)) ||
      !input.audits.every(v => exact(v, AUDIT_KEYS) && syntheticKey(v.syntheticKey) &&
        Array.isArray(v.entries) && v.entries.length <= 128)) {
    throw new Error('B293D_UNTRUSTED_SYNTHETIC_INPUT');
  }
  const a = indexByKey(input.approvals);
  const b = indexByKey(input.audits);
  const counters = Object.fromEntries(COUNTER_KEYS.map(key => [key, 0]));
  counters.duplicateApprovalKeys = a.duplicate.size;
  counters.duplicateAuditKeys = b.duplicate.size;
  let matchedPairs = 0;
  let consumedApprovals = 0;
  let retentionReviewCandidates = 0;
  const allKeys = new Set([...a.map.keys(), ...b.map.keys()]);
  for (const key of allKeys) {
    // Ambiguous fixture keys are never reconciled optimistically.
    if (a.duplicate.has(key) || b.duplicate.has(key)) continue;
    const approval = a.map.get(key);
    const audit = b.map.get(key);
    if (!approval) {
      counters.orphanAudit++;
      continue;
    }
    const consumed = approval.status === 'CONSUMED_FOR_REVIEW_ONLY';
    if (consumed) consumedApprovals++;
    const scopeValid = scopeOK(approval);
    const revisionValid = revisionOK(approval);
    const timelineValid = timelineOK(approval);
    if (!scopeValid) counters.invalidScope++;
    if (!revisionValid) counters.invalidRevision++;
    if (!timelineValid) counters.invalidTimeline++;
    if (!audit) {
      if (consumed) counters.missingAudit++;
      continue;
    }
    if (!consumed) counters.auditWithoutConsumption++;
    const auditValid = validAudit(audit);
    if (!auditValid) counters.invalidAudit++;
    if (consumed && auditValid &&
        audit.entries[0].atMs !== approval.consumedAtMs) {
      counters.timestampMismatch++;
    }
    if (consumed && scopeValid && revisionValid && timelineValid &&
        auditValid && audit.entries[0].atMs === approval.consumedAtMs) {
      matchedPairs++;
      if (audit.entries[0].reviewAfterMs <= input.nowMs) retentionReviewCandidates++;
    }
  }
  const totalIssues = COUNTER_KEYS.reduce((n, key) => n + counters[key], 0);
  return Object.freeze({
    phase: REVIEW_RECONCILIATION_PHASE,
    version: REVIEW_RECONCILIATION_VERSION,
    decision: 'BLOCKED',
    approvalsInspected: input.approvals.length,
    auditsInspected: input.audits.length,
    matchedSyntheticPairs: matchedPairs,
    consumedApprovals,
    ...counters,
    totalIssues,
    shapeReconciled: totalIssues === 0 && matchedPairs > 0,
    retentionReviewCandidates,
    proposedRetentionDays: REVIEW_AUDIT_PROPOSED_RETENTION_DAYS,
    sourceIsTrusted: false,
    externalAnchorVerified: false,
    backendIdentityVerified: false,
    auditDurabilityVerified: false,
    automatedRepairAllowed: false,
    approvalWriterIntegrated: false,
    auditProductionPersisted: false,
    persistentWritesAllowed: false,
    privateRecoveryRead: false,
    privateRecoveryWritten: false,
    sourceDeletionAllowed: false,
    publicVisibilityAllowed: false,
  });
}

export function assertSyntheticReconciliationMayRepair() {
  throw new Error('B293D_REPAIR_NOT_AUTHORIZED');
}
