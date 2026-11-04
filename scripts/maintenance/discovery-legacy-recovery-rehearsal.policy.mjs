// Issue #236 — pure, no-I/O preparation of legacy preference recovery candidates.
// All raw values, owner IDs and individual hashes stay IN MEMORY and are never
// serialized to stdout, audit logs or files by the rehearsal runner.
import { createHash } from 'node:crypto';
import { PRIVATE_DISCOVERY_INTEREST_FIELDS } from './discovery-legacy-preferences-audit.policy.mjs';

export const PROJECT_ID = 'entretenimento-sexual';
export const ISOLATED_FIRESTORE = '127.0.0.1:28080';
export const EMULATOR_PORT = 28080;
export const WEBSOCKET_PORT = 29150;
export const MAX_PUBLIC_PROFILES = 200;
export const TARGET_COLLECTION = 'legacy_discovery_preference_recovery';
export const RECOVERABLE_FIELDS = Object.freeze([
  'interestedInGenders',
  'interestedInOrientations',
]);

const OTHER_PRIVATE_FIELDS = new Set(
  PRIVATE_DISCOVERY_INTEREST_FIELDS.filter((key) => !RECOVERABLE_FIELDS.includes(key))
);

export function assertRehearsalOnly(env, args) {
  if (args.length !== 1 || args[0] !== '--dry-run') {
    throw new Error('ONLY_DRY_RUN');
  }

  for (const name of ['FIREBASE_PROJECT_ID', 'GCLOUD_PROJECT', 'GCP_PROJECT', 'GOOGLE_CLOUD_PROJECT']) {
    if (env[name] && env[name] !== PROJECT_ID) {
      throw new Error('PROJECT_MISMATCH');
    }
  }
  // The runner starts a CHILD emulator. Reject a preselected remote or live
  // emulator host rather than silently reusing the operator's environment.
  if (env.FIRESTORE_EMULATOR_HOST && env.FIRESTORE_EMULATOR_HOST !== ISOLATED_FIRESTORE) {
    throw new Error('EXTERNAL_EMULATOR_HOST');
  }
  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('CREDENTIALS_NOT_ALLOWED');
  }
}

export function assertSourceLimit(scanned) {
  if (!Number.isInteger(scanned) || scanned < 0 || scanned > MAX_PUBLIC_PROFILES) {
    throw new Error('SOURCE_LIMIT_EXCEEDED');
  }
}

export function candidateFromPublicProfile(ownerUid, publicData) {
  if (typeof ownerUid !== 'string' || ownerUid.length < 1 ||
      ownerUid.length > 128 || ownerUid.includes('/')) {
    throw new Error('INVALID_OWNER');
  }
  if (!publicData || typeof publicData !== 'object' || Array.isArray(publicData)) {
    throw new Error('INVALID_PROFILE');
  }
  const exists = (key) => Object.hasOwn(publicData, key);
  const prohibitedOther = [...OTHER_PRIVATE_FIELDS].some(exists);
  if (prohibitedOther) throw new Error('UNREVIEWED_PRIVATE_FIELD');

  if (!RECOVERABLE_FIELDS.some(exists)) return null;

  const legacyRaw = {};
  for (const field of RECOVERABLE_FIELDS) {
    if (!exists(field)) continue;

    const values = publicData[field];
    if (!Array.isArray(values) || values.length > 100 ||
        values.some((value) => typeof value !== 'string' ||
          value.trim().length === 0 || value.length > 1024)) {
      throw new Error('UNSUPPORTED_LEGACY_SHAPE');
    }
    // Preserve original strings, ordering, duplicates, and even empty arrays.
    legacyRaw[field] = [...values];
  }

  const contentSha256 = hashLegacy(ownerUid, legacyRaw);
  const record = {
    schemaVersion: 1,
    ownerUid,
    sourceCollection: 'public_profiles',
    lifecycle: 'PENDING_REVIEW',
    visibilityConsentConfirmed: false,
    legacyRaw,
    contentSha256,
  };

  // In-memory invariant. No data, path, UID or digest is logged.
  if (hashLegacy(ownerUid, record.legacyRaw) !== record.contentSha256) {
    throw new Error('INTEGRITY_FAILURE');
  }

  return record;
}

export function hashLegacy(ownerUid, raw) {
  // Fixed order and explicit presence markers preserve difference between
  // absent and empty arrays. Hash is evidence only, not a value to disclose.
  const encoded = JSON.stringify([
    1,
    ownerUid,
    ...RECOVERABLE_FIELDS.map((key) => [
      key, Object.hasOwn(raw, key), Object.hasOwn(raw, key) ? raw[key] : null,
    ]),
  ]);
  return createHash('sha256').update(encoded, 'utf8').digest('hex');
}

export function assessExistingRecovery(candidate, existing) {
  if (!candidate) throw new Error('MISSING_CANDIDATE');
  if (existing === undefined || existing === null) return 'WOULD_CREATE';

  // Never overwrite or infer that an existing record belongs to this source.
  const identical = existing.ownerUid === candidate.ownerUid
    && existing.schemaVersion === candidate.schemaVersion
    && existing.sourceCollection === candidate.sourceCollection
    && existing.contentSha256 === candidate.contentSha256
    && hashLegacy(existing.ownerUid, existing.legacyRaw ?? {}) === candidate.contentSha256
    && existing.lifecycle === 'PENDING_REVIEW'
    && existing.visibilityConsentConfirmed === false;

  if (!identical) throw new Error('RECOVERY_CONFLICT');
  return 'ALREADY_PRESERVED';
}

export function newAggregate() {
  return {
    mode: 'DRY_RUN',
    source: 'ISOLATED_SNAPSHOT',
    recoveredDocumentsWritten: 0,
    publicDocumentsWritten: 0,
    activePreferencesWritten: 0,
    scannedPublicProfiles: 0,
    candidates: 0,
    interestedInGendersItems: 0,
    interestedInOrientationsItems: 0,
    wouldCreate: 0,
    alreadyPreserved: 0,
    ownerDocumentsFound: 0,
    requiresSemanticReview: true,
    requiresOwnerVisibilityDecision: true,
    sourceTimestampFidelityProven: false,
  };
}

export function addCandidateToAggregate(report, candidate, disposition, ownerExists) {
  if (!candidate) return;
  if (!ownerExists) throw new Error('OWNER_DOCUMENT_MISSING');

  report.candidates += 1;
  report.ownerDocumentsFound += 1;
  report.interestedInGendersItems += candidate.legacyRaw.interestedInGenders?.length ?? 0;
  report.interestedInOrientationsItems += candidate.legacyRaw.interestedInOrientations?.length ?? 0;
  if (disposition === 'WOULD_CREATE') report.wouldCreate += 1;
  else if (disposition === 'ALREADY_PRESERVED') report.alreadyPreserved += 1;
  else throw new Error('UNKNOWN_DISPOSITION');
}
