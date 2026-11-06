// Issue #236 / B2.9.3b - PURE, synthetic, in-memory audit-integrity proposal.
// Hash chaining is tamper-evident only against a trusted external anchor.
// No Firebase, file/network IO, UIDs, operation IDs, real records or persistence.
import { createHash } from 'node:crypto';

export const REVIEW_AUDIT_VERSION = 1;
export const REVIEW_AUDIT_PROPOSED_RETENTION_DAYS = 30;
export const REVIEW_AUDIT_PHASE = 'B2_9_3B_SYNTHETIC_AUDIT_CONTRACT';
const RETENTION_MS = REVIEW_AUDIT_PROPOSED_RETENTION_DAYS * 24 * 60 * 60_000;
const ZERO_HASH = '0'.repeat(64);
const MAX_EVENTS = 128;
const MIN_TIME = 1_700_000_000_000;
const MAX_TIME = 4_000_000_000_000;
const ENTRY_KEYS = Object.freeze([
  'schemaVersion', 'sequence', 'kind', 'atMs', 'reviewAfterMs',
  'previousHash', 'entryHash',
]);
export const REVIEW_AUDIT_KINDS = Object.freeze({
  PRECHECK_BLOCKED: 'PRECHECK_BLOCKED',
  CONSUMED_SYNTHETIC: 'CONSUMED_FOR_REVIEW_SYNTHETIC',
  REVOKED_SYNTHETIC: 'REVOKED_REVIEW_SYNTHETIC',
  EXPIRED_SYNTHETIC: 'EXPIRED_REVIEW_SYNTHETIC',
  REPLAY_BLOCKED: 'REPLAY_BLOCKED',
});
const TERMINAL = new Set([
  REVIEW_AUDIT_KINDS.CONSUMED_SYNTHETIC,
  REVIEW_AUDIT_KINDS.REVOKED_SYNTHETIC,
  REVIEW_AUDIT_KINDS.EXPIRED_SYNTHETIC,
]);
const ALL_KINDS = new Set(Object.values(REVIEW_AUDIT_KINDS));

function plain(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) &&
    Object.getPrototypeOf(v) === Object.prototype;
}
function exactKeys(v) {
  return plain(v) && Object.keys(v).length === ENTRY_KEYS.length &&
    ENTRY_KEYS.every(k => Object.hasOwn(v, k));
}
function validTime(v) {
  return Number.isSafeInteger(v) && v >= MIN_TIME && v <= MAX_TIME;
}
function validHash(v) {
  return typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
}
function digest({ schemaVersion, sequence, kind, atMs, reviewAfterMs, previousHash }) {
  // Canonical ordered fields and domain separation; never hash a UID or raw value.
  const canonical = JSON.stringify([
    'B2_9_3B_SYNTHETIC_ONLY', schemaVersion, sequence, kind,
    atMs, reviewAfterMs, previousHash,
  ]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
function allowed(previous, kind) {
  if (!ALL_KINDS.has(kind)) return false;
  if (previous.length === 0) return kind !== REVIEW_AUDIT_KINDS.REPLAY_BLOCKED;
  const priorKinds = previous.map(x => x.kind);
  const terminal = priorKinds.find(k => TERMINAL.has(k));
  if (!terminal) return kind !== REVIEW_AUDIT_KINDS.REPLAY_BLOCKED;
  return terminal === REVIEW_AUDIT_KINDS.CONSUMED_SYNTHETIC &&
    kind === REVIEW_AUDIT_KINDS.REPLAY_BLOCKED;
}

/** Validate only an in-memory stream for ONE anonymous synthetic review. */
export function verifySyntheticReviewAuditChain(entries) {
  if (!Array.isArray(entries) || entries.length > MAX_EVENTS) return false;
  let previousHash = ZERO_HASH;
  const seen = [];
  let lastTime = MIN_TIME - 1;
  for (let index = 0; index < entries.length; index++) {
    const e = entries[index];
    if (!exactKeys(e) || e.schemaVersion !== REVIEW_AUDIT_VERSION ||
        e.sequence !== index + 1 || !validTime(e.atMs) ||
        e.atMs <= lastTime || !Number.isSafeInteger(e.reviewAfterMs) ||
        e.reviewAfterMs !== e.atMs + RETENTION_MS ||
        !validHash(e.previousHash) || e.previousHash !== previousHash ||
        !validHash(e.entryHash) ||
        !allowed(seen, e.kind) || e.entryHash !== digest(e)) return false;
    previousHash = e.entryHash;
    lastTime = e.atMs;
    seen.push(e);
  }
  return true;
}

/** Append only a minimal anonymous synthetic event, without arbitrary payload. */
export function appendSyntheticReviewAuditEvent(entries, input) {
  if (!Array.isArray(entries) || !verifySyntheticReviewAuditChain(entries) ||
      entries.length >= MAX_EVENTS || !plain(input) ||
      Object.keys(input).length !== 2 || !Object.hasOwn(input, 'kind') ||
      !Object.hasOwn(input, 'atMs') || !validTime(input.atMs) ||
      input.atMs > MAX_TIME - RETENTION_MS || !allowed(entries, input.kind) ||
      (entries.length > 0 && input.atMs <= entries.at(-1).atMs)) {
    throw new Error('B293B_AUDIT_EVENT_DENIED');
  }
  const base = {
    schemaVersion: REVIEW_AUDIT_VERSION,
    sequence: entries.length + 1,
    kind: input.kind,
    atMs: input.atMs,
    reviewAfterMs: input.atMs + RETENTION_MS,
    previousHash: entries.length ? entries.at(-1).entryHash : ZERO_HASH,
  };
  const entry = Object.freeze({ ...base, entryHash: digest(base) });
  return Object.freeze([...entries, entry]);
}

/** Reporting is aggregate-only; age means candidate for review, never deletion. */
export function assessSyntheticReviewAudit(entries, nowMs) {
  if (!validTime(nowMs)) throw new Error('B293B_INVALID_ASSESSMENT_TIME');
  const compatible = verifySyntheticReviewAuditChain(entries);
  const count = compatible ? entries.length : 0;
  const reviewCandidates = compatible ?
    entries.filter(x => x.reviewAfterMs <= nowMs).length : 0;
  return Object.freeze({
    phase: REVIEW_AUDIT_PHASE,
    decision: 'BLOCKED',
    integrityShapeCompatible: compatible,
    eventsValidated: count,
    retentionReviewCandidates: reviewCandidates,
    proposedRetentionDays: REVIEW_AUDIT_PROPOSED_RETENTION_DAYS,
    trustAnchorVerified: false,
    backendAuthorityVerified: false,
    auditPersisted: false,
    retentionPolicyApproved: false,
    expirationJobImplemented: false,
    deletionAllowed: false,
    approvalWriterIntegrated: false,
    approvalConsumed: false,
    privateRecoveryRead: false,
    privateRecoveryWritten: false,
    persistentWritesAllowed: false,
    sourceDeletionAllowed: false,
    publicVisibilityAllowed: false,
  });
}

export function assertReviewAuditMayPersist() {
  throw new Error('B293B_PERSISTENCE_NOT_AUTHORIZED');
}
