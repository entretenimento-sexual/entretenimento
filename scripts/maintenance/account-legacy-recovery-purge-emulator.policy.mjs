// Issue #236 — B2.4, synthetic-only real Firestore Emulator contract.
// This file is pure. No Firebase SDK, I/O, logging, runtime env mutations.
export const SYNTHETIC_PURGE_PROJECT = 'demo-entretenimento-legacy-purge';
export const SYNTHETIC_PURGE_HOST = '127.0.0.1:28080';
export const SYNTHETIC_PURGE_PORT = 28080;
export const SYNTHETIC_PURGE_WEBSOCKET_PORT = 29150;
export const SYNTHETIC_PURGE_FLAG = '--isolated-synthetic-purge-test';

export function assertSyntheticPurgeInvocation(env, args) {
  if (!Array.isArray(args) || args.length !== 1 ||
      args[0] !== SYNTHETIC_PURGE_FLAG) {
    throw new Error('SYNTHETIC_PURGE_EXPLICIT_FLAG_REQUIRED');
  }
  for (const key of [
    'GOOGLE_APPLICATION_CREDENTIALS',
    'GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'GCP_PROJECT',
    'FIREBASE_PROJECT_ID', 'FIREBASE_CONFIG', 'FUNCTIONS_EMULATOR',
    'FIRESTORE_EMULATOR_HOST',
  ]) {
    if (env[key]) throw new Error('SYNTHETIC_PURGE_UNSAFE_ENVIRONMENT');
  }
}

const PUBLIC_REPORT_FIELDS = new Set([
  'mode', 'project', 'host', 'originalCheckpointImported',
  'productionModified', 'primaryEmulatorModified',
  'successRecoveryDocumentsDeleted', 'successDescendantsDeleted',
  'idempotentRepeatRemoved', 'orphanDescendantCleared',
  'otherOwnerPreserved', 'mismatchedOwnerRejected',
  'expiredLeaseRejected', 'activeAccountRejected',
  'preferencesDomainFailedOnConflict', 'accountFinalizationBlocked',
  'privateRecoveryWriterEnabled',
]);

export function assertSyntheticEmulatorReport(report) {
  if (!report || typeof report !== 'object' ||
      Object.keys(report).length !== PUBLIC_REPORT_FIELDS.size ||
      Object.keys(report).some((key) => !PUBLIC_REPORT_FIELDS.has(key)) ||
      report.mode !== 'SYNTHETIC_FIRESTORE_PURGE_E2E' ||
      report.project !== SYNTHETIC_PURGE_PROJECT ||
      report.host !== SYNTHETIC_PURGE_HOST ||
      report.originalCheckpointImported !== false ||
      report.productionModified !== false ||
      report.primaryEmulatorModified !== false ||
      report.successRecoveryDocumentsDeleted !== 1 ||
      report.successDescendantsDeleted !== 2 ||
      report.idempotentRepeatRemoved !== 0 ||
      report.orphanDescendantCleared !== true ||
      report.otherOwnerPreserved !== true ||
      report.mismatchedOwnerRejected !== true ||
      report.expiredLeaseRejected !== true ||
      report.activeAccountRejected !== true ||
      report.preferencesDomainFailedOnConflict !== true ||
      report.accountFinalizationBlocked !== true ||
      report.privateRecoveryWriterEnabled !== false) {
    throw new Error('SYNTHETIC_PURGE_EVIDENCE_INCOMPLETE');
  }
  return Object.freeze({ ...report });
}
