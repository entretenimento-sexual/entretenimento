// Issue #236 — B2.1: pure safety and logical-snapshot comparison helpers.
// No Firebase initialization, I/O, logging or data mutation in this module.
import { createHash } from 'node:crypto';
import {
  PROJECT_ID, ISOLATED_FIRESTORE, MAX_PUBLIC_PROFILES,
} from './discovery-legacy-recovery-rehearsal.policy.mjs';

export const INCIDENT_CANDIDATES = 2;
export const INCIDENT_GENDER_ITEMS = 5;
export const INCIDENT_ORIENTATION_ITEMS = 3;
export const MAX_SNAPSHOT_DOCUMENTS = 2500;
export const MAX_SNAPSHOT_COLLECTIONS = 600;

export function assertIsolatedRollbackInvocation(env, args) {
  if (args.length !== 1 || args[0] !== '--isolated-rollback-test') {
    throw new Error('EXPLICIT_ISOLATED_ROLLBACK_FLAG_REQUIRED');
  }
  if (env.GOOGLE_APPLICATION_CREDENTIALS) {
    throw new Error('CREDENTIALS_NOT_ALLOWED');
  }
  if (env.FIRESTORE_EMULATOR_HOST &&
      env.FIRESTORE_EMULATOR_HOST !== ISOLATED_FIRESTORE) {
    throw new Error('UNSAFE_PRESELECTED_FIRESTORE_HOST');
  }
  for (const variable of [
    'FIREBASE_PROJECT_ID', 'GCLOUD_PROJECT', 'GCP_PROJECT',
    'GOOGLE_CLOUD_PROJECT',
  ]) {
    if (env[variable] && env[variable] !== PROJECT_ID) {
      throw new Error('PROJECT_MISMATCH');
    }
  }
}

export function assertExpectedIncident(candidateCount, genders, orientations) {
  if (candidateCount !== INCIDENT_CANDIDATES ||
      genders !== INCIDENT_GENDER_ITEMS ||
      orientations !== INCIDENT_ORIENTATION_ITEMS) {
    throw new Error('SNAPSHOT_INCIDENT_DOES_NOT_MATCH');
  }
}

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : { specialNumber: String(value) };
  }
  if (typeof value === 'bigint') return { bigint: String(value) };
  if (value === undefined) return { undefined: true };
  if (Array.isArray(value)) return value.map(canonical);
  if (value instanceof Date) return { date: value.toISOString() };
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { bytes: Buffer.from(value).toString('base64') };
  }
  if (value && typeof value === 'object' &&
      typeof value.seconds === 'number' &&
      typeof value.nanoseconds === 'number') {
    return { timestamp: [value.seconds, value.nanoseconds] };
  }
  if (value && typeof value === 'object' &&
      typeof value.latitude === 'number' &&
      typeof value.longitude === 'number') {
    return { geopoint: [value.latitude, value.longitude] };
  }
  if (value && typeof value.path === 'string' && value.firestore) {
    return { reference: value.path };
  }
  if (value && typeof value.toArray === 'function') {
    return { vector: value.toArray().map(canonical) };
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonical(value[key])])
    );
  }
  throw new Error('UNSUPPORTED_SNAPSHOT_VALUE');
}

export function digestDocumentFields(fields) {
  return createHash('sha256')
    .update(JSON.stringify(canonical(fields)), 'utf8')
    .digest('hex');
}

export function validateLogicalSnapshot(before, after) {
  if (!(before instanceof Map) || !(after instanceof Map)) {
    throw new Error('INVALID_SNAPSHOT');
  }
  if (before.size === 0 || before.size > MAX_SNAPSHOT_DOCUMENTS ||
      before.size !== after.size) {
    throw new Error('SNAPSHOT_DOCUMENT_COUNT_MISMATCH');
  }
  for (const [path, hash] of before) {
    if (!after.has(path) || after.get(path) !== hash) {
      // Never leak document paths, UID or sensitive values to stderr.
      throw new Error('SNAPSHOT_CONTENT_MISMATCH');
    }
  }
  return { documentsVerified: before.size, contentDifferences: 0 };
}

export function safeRollbackSummary({
  documentsVerified, scanned, candidateCount, genders, orientations,
  first, second, deleted,
}) {
  assertExpectedIncident(candidateCount, genders, orientations);
  if (first.createdCount + first.alreadyPreservedCount !== candidateCount ||
      second.createdCount !== 0 ||
      second.alreadyPreservedCount !== candidateCount ||
      deleted.deletedCount !== first.createdCount) {
    throw new Error('IDEMPOTENCE_OR_ROLLBACK_FAILURE');
  }
  return {
    mode: 'ISOLATED_IMPORT_COPY_VERIFY_ROLLBACK',
    project: PROJECT_ID,
    host: ISOLATED_FIRESTORE,
    scannedPublicProfiles: scanned,
    candidates: candidateCount,
    interestedInGendersItems: genders,
    interestedInOrientationsItems: orientations,
    initiallyCreated: first.createdCount,
    idempotentSecondRunCreated: second.createdCount,
    rolledBack: deleted.deletedCount,
    snapshotDocumentsVerified: documentsVerified,
    contentDifferences: 0,
    mainEmulatorModified: false,
    originalExportModified: false,
    productionModified: false,
    metadataTimestampFidelityProven: false,
    ownerConsentRequired: true,
  };
}

export function assertScannedPublicProfiles(count) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_PUBLIC_PROFILES) {
    throw new Error('PUBLIC_PROFILE_LIMIT_EXCEEDED');
  }
}
