// Issue #236 — synthetic-only plan for a reversible, field-specific sanitation
// rehearsal. No IO, Admin SDK, credentials, exported writer, or real-data authority.
// Deliberately reuse the existing B2.1 canonical recoverable-field contract.
import {
  RECOVERABLE_FIELDS,
  candidateFromPublicProfile,
  assessExistingRecovery,
} from './discovery-legacy-recovery-rehearsal.policy.mjs';
import {
  verifyRecoveryCandidates,
} from './discovery-legacy-recovery-transaction.policy.mjs';

const RECOVERY_FIELDS = Object.freeze([
  'schemaVersion', 'ownerUid', 'sourceCollection', 'lifecycle',
  'visibilityConsentConfirmed', 'legacyRaw', 'contentSha256',
]);
const OWNER_ID = /^synthetic-issue236-[a-z0-9-]{1,48}$/;

function record(v) {
  return v !== null && typeof v === 'object' &&
    !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
}
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (record(v)) return Object.fromEntries(
    Object.keys(v).sort().map(k => [k,canonical(v[k])])
  );
  if (v === null || typeof v === 'string' || typeof v === 'boolean' ||
      (typeof v === 'number' && Number.isFinite(v))) return v;
  throw new Error('B293G_INVALID_SYNTHETIC_VALUE');
}
function identical(a,b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
function eligibleOwner(owner) {
  return record(owner) && owner.accountStatus === 'active' &&
    owner.suspended !== true && owner.interactionBlocked !== true &&
    owner.accountLocked !== true && owner.loginAllowed !== false &&
    owner.deletionRequestedAt == null && owner.deletedAt == null &&
    owner.purgeStartedAt == null && owner.purgeLeaseOwner == null &&
    owner.purgeLeaseUntil == null && owner.legalHold !== true &&
    owner.billingHold !== true;
}

export const SYNTHETIC_SANITIZATION_PHASE = 'B2_9_3G_SYNTHETIC_ONLY';

/** Pure projection; retains every unrelated field byte-for-byte at logical level. */
export function expectedSanitizedSyntheticProfile(original) {
  if (!record(original)) throw new Error('B293G_INVALID_BASELINE');
  const clean = structuredClone(original);
  for (const field of RECOVERABLE_FIELDS) delete clean[field];
  return clean;
}

/**
 * Candidate and source are never logged; authorization remains BLOCKED.
 * Returns ONLY field names and a no-op marker, never private values.
 * All inputs are untrusted, even for this emulator-only rehearsal.
 */
export function planIsolatedSyntheticSanitization(input) {
  if (!record(input) ||
      !['ownerUid','owner','source','recovery','candidate','baseline']
        .every(k => Object.hasOwn(input,k)) || Object.keys(input).length !== 6 ||
      typeof input.ownerUid !== 'string' || !OWNER_ID.test(input.ownerUid) ||
      !eligibleOwner(input.owner) || !record(input.source) ||
      !record(input.recovery) || !record(input.baseline)) {
    throw new Error('B293G_INPUT_DENIED');
  }
  verifyRecoveryCandidates([input.candidate]);
  if (input.candidate.ownerUid !== input.ownerUid ||
      !identical(input.baseline.uid,input.ownerUid)) {
    throw new Error('B293G_OWNER_MISMATCH');
  }
  const expectedCandidate = candidateFromPublicProfile(
    input.ownerUid, input.baseline
  );
  if (!expectedCandidate ||
      !identical(expectedCandidate,input.candidate) ||
      Object.keys(input.recovery).length !== RECOVERY_FIELDS.length ||
      !RECOVERY_FIELDS.every(k => Object.hasOwn(input.recovery,k)) ||
      assessExistingRecovery(input.candidate,input.recovery) !== 'ALREADY_PRESERVED') {
    throw new Error('B293G_RECOVERY_CONFLICT');
  }
  const sanitized = expectedSanitizedSyntheticProfile(input.baseline);
  if (identical(input.source,sanitized)) {
    return Object.freeze({ fieldNames:Object.freeze([]), alreadySanitized:true });
  }
  if (!identical(input.source,input.baseline)) {
    throw new Error('B293G_SOURCE_CHANGED');
  }
  const fieldNames = RECOVERABLE_FIELDS.filter(x => Object.hasOwn(input.source,x));
  if (!fieldNames.length) throw new Error('B293G_NO_TARGET_FIELDS');
  return Object.freeze({fieldNames:Object.freeze(fieldNames),alreadySanitized:false});
}

export function assertSyntheticSanitizationNeverAuthorizesRealData() {
  throw new Error('B293G_PRODUCTION_SANITIZATION_DENIED');
}
