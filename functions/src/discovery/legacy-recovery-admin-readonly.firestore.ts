// Issue #236 — B2.7: internal backend AUTHORITY READS, not authorization.
// Not exported from index.ts. No callable, HTTP, scheduled trigger or writer.
// Only permit the dedicated disposable Auth + Firestore demo emulators.
// A result of this probe MUST NEVER authorize persistence or disclosure.
import type { Auth } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';

export const LEGACY_RECOVERY_APPROVAL_COLLECTION =
  'legacy_discovery_recovery_approvals';
export const LEGACY_RECOVERY_READONLY_PROJECT =
  'demo-entretenimento-legacy-governance';
const PURPOSE = 'PRIVATE_LEGACY_DISCOVERY_PRESERVATION_REVIEW';
const APPROVAL_WINDOW_MS = 15 * 60_000;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9_-]{12,128}$/;
const UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

export interface LegacyRecoveryReadOnlyBackend {
  auth: Pick<Auth, 'verifyIdToken' | 'getUser'>;
  firestore: Pick<Firestore, 'collection'>;
}

export interface LegacyRecoveryReadOnlyRequest {
  operationId: string;
  operatorIdToken: string;
}

export interface LegacyRecoveryReadOnlyReport {
  phase: 'B2_7_BACKEND_READ_ONLY';
  decision: 'BLOCKED';
  authoritySource: 'FIREBASE_AUTH_AND_USERS_DOCUMENTS';
  identityReadVerified: boolean;
  operatorPrivilegeCurrent: boolean;
  reviewerPrivilegeCurrent: boolean;
  approvalRecordConsistent: boolean;
  reviewerIndependent: boolean;
  backendWriterIntegrated: false;
  approvalRecordConsumed: false;
  auditPersisted: false;
  privateRecoveryRead: false;
  privateRecoveryWritten: false;
  ownerConsentEstablished: false;
  persistentWritesAllowed: false;
  sourceFieldsDeletionAllowed: false;
  visibilityActivationAllowed: false;
}

function report(fields: Partial<Pick<LegacyRecoveryReadOnlyReport,
  'identityReadVerified' | 'operatorPrivilegeCurrent' |
  'reviewerPrivilegeCurrent' | 'approvalRecordConsistent' |
  'reviewerIndependent'>> = {}): LegacyRecoveryReadOnlyReport {
  const result: LegacyRecoveryReadOnlyReport = {
    phase: 'B2_7_BACKEND_READ_ONLY',
    decision: 'BLOCKED',
    authoritySource: 'FIREBASE_AUTH_AND_USERS_DOCUMENTS',
    identityReadVerified: fields.identityReadVerified === true,
    operatorPrivilegeCurrent: fields.operatorPrivilegeCurrent === true,
    reviewerPrivilegeCurrent: fields.reviewerPrivilegeCurrent === true,
    approvalRecordConsistent: fields.approvalRecordConsistent === true,
    reviewerIndependent: fields.reviewerIndependent === true,
    backendWriterIntegrated: false,
    approvalRecordConsumed: false,
    auditPersisted: false,
    privateRecoveryRead: false,
    privateRecoveryWritten: false,
    ownerConsentEstablished: false,
    persistentWritesAllowed: false,
    sourceFieldsDeletionAllowed: false,
    visibilityActivationAllowed: false,
  };
  return Object.freeze(result);
}

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function uid(value: unknown): value is string {
  return typeof value === 'string' && UID_PATTERN.test(value);
}

function clock(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) &&
    value >= 1_700_000_000_000 && value <= 4_000_000_000_000;
}

function currentAdmin(
  data: unknown,
  capability: 'privateRecoveryOperator' | 'privateRecoveryReviewer'
): boolean {
  const user = record(data);
  if (!user) return false;
  const prohibited = [
    'deletionRequestedAt', 'deletedAt', 'purgeAfter', 'purgeStartedAt',
    'purgeLeaseOwner', 'purgeLeaseUntil', 'adminPrivilegeRevokedAt',
  ];
  return user['role'] === 'admin' &&
    user['accountStatus'] === 'active' &&
    user[capability] === true &&
    user['suspended'] !== true &&
    user['interactionBlocked'] !== true &&
    user['accountLocked'] !== true &&
    user['loginAllowed'] !== false &&
    user['legalHold'] !== true &&
    user['billingHold'] !== true &&
    prohibited.every((key) => user[key] == null);
}

function approvalMatches(
  raw: unknown,
  operationId: string,
  operatorUid: string,
  reviewerUid: string,
  now: number
): boolean {
  const entry = record(raw);
  if (!entry) return false;
  const approvedAt = entry['approvedAtMs'];
  const expiresAt = entry['expiresAtMs'];
  return entry['operationId'] === operationId &&
    entry['purpose'] === PURPOSE &&
    entry['status'] === 'APPROVED_FOR_REVIEW_ONLY' &&
    entry['projectId'] === 'entretenimento-sexual' &&
    entry['targetCollection'] ===
      'legacy_discovery_preference_recovery' &&
    entry['candidateCount'] === 2 &&
    entry['legacyEntryCount'] === 8 &&
    entry['requestedByUid'] === operatorUid &&
    entry['approvedByUid'] === reviewerUid &&
    entry['revokedAtMs'] == null &&
    entry['consumedAtMs'] == null &&
    clock(approvedAt) && clock(expiresAt) &&
    approvedAt <= now && expiresAt > now &&
    expiresAt - approvedAt <= APPROVAL_WINDOW_MS;
}

function isolatedRuntime(env: NodeJS.ProcessEnv): boolean {
  return env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:28080' &&
    env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:29099' &&
    env.GCLOUD_PROJECT === LEGACY_RECOVERY_READONLY_PROJECT &&
    env.FUNCTIONS_EMULATOR === 'true' &&
    !env.GOOGLE_APPLICATION_CREDENTIALS &&
    !env.GOOGLE_CLOUD_PROJECT &&
    !env.GCP_PROJECT;
}

/**
 * Backend-only evidence probe. The Auth and Firestore objects must be
 * injected by the trusted server; none are initialized or exported here.
 * A real approval author/permission ledger has NOT been implemented.
 *
 * Even five consistent reads are not authorization to write, migrate,
 * delete source fields or activate preferences. No result contains UID.
 */
export async function inspectLegacyRecoveryAdminReadOnly(
  backend: LegacyRecoveryReadOnlyBackend,
  request: LegacyRecoveryReadOnlyRequest,
  now: number = Date.now()
): Promise<LegacyRecoveryReadOnlyReport> {
  // Runtime selection must come from the SERVER process, not an injectable
  // environment argument. This is still not a permission to persist.
  if (!isolatedRuntime(process.env) || !clock(now) ||
      !OPERATION_ID_PATTERN.test(request?.operationId ?? '') ||
      typeof request?.operatorIdToken !== 'string' ||
      request.operatorIdToken.length < 20 ||
      request.operatorIdToken.length > 8192) {
    return report();
  }

  try {
    // checkRevoked=true; never authorize from old JWT admin/role claims.
    const verified = await backend.auth.verifyIdToken(
      request.operatorIdToken, true
    );
    if (!uid(verified.uid) ||
        typeof verified.auth_time !== 'number' ||
        !Number.isSafeInteger(verified.auth_time) ||
        verified.auth_time * 1000 > now ||
        now - verified.auth_time * 1000 > APPROVAL_WINDOW_MS) {
      return report();
    }
    const principal = await backend.auth.getUser(verified.uid);
    if (principal.disabled || !principal.emailVerified ||
        principal.uid !== verified.uid) {
      return report();
    }

    // Existing authority model: canonical current users/{uid}, not claims.
    const operator = await backend.firestore.collection('users')
      .doc(verified.uid).get();
    if (!operator.exists || !currentAdmin(
      operator.data(), 'privateRecoveryOperator'
    )) {
      return report({ identityReadVerified: true });
    }

    // Proposed internal ledger. This is a READ, not an approval writer.
    const approval = await backend.firestore
      .collection(LEGACY_RECOVERY_APPROVAL_COLLECTION)
      .doc(request.operationId).get();
    if (!approval.exists) {
      return report({
        identityReadVerified: true, operatorPrivilegeCurrent: true,
      });
    }
    const approvalData = record(approval.data());
    const reviewerUid = approvalData?.['approvedByUid'];
    if (!uid(reviewerUid) || reviewerUid === verified.uid) {
      return report({
        identityReadVerified: true, operatorPrivilegeCurrent: true,
      });
    }
    const reviewerAuth = await backend.auth.getUser(reviewerUid);
    if (reviewerAuth.disabled || !reviewerAuth.emailVerified ||
        reviewerAuth.uid !== reviewerUid) {
      return report({
        identityReadVerified: true, operatorPrivilegeCurrent: true,
        reviewerIndependent: true,
      });
    }
    const reviewer = await backend.firestore.collection('users')
      .doc(reviewerUid).get();
    const reviewerCurrent = reviewer.exists &&
      currentAdmin(reviewer.data(), 'privateRecoveryReviewer');
    const approvalConsistent = reviewerCurrent && approvalMatches(
      approvalData, request.operationId, verified.uid, reviewerUid, now
    );
    return report({
      identityReadVerified: true,
      operatorPrivilegeCurrent: true,
      reviewerIndependent: true,
      reviewerPrivilegeCurrent: reviewerCurrent,
      approvalRecordConsistent: approvalConsistent,
    });
  } catch {
    // Network, missing data, token revocation, or transient Firestore
    // failures are all fail-closed. Do not log JWT, UID, path, error body.
    return report();
  }
}
